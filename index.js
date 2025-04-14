const { ethers } = require("ethers")
const { competitionAbi, erc20Abi, routerAbi, factoryAbi, peripheryAbi } = require("./abi")
const { balanceOf, sendDiscordMessage, getTradeDecision } = require("./util")
const fs = require("fs").promises
const { GoogleGenerativeAI } = require("@google/generative-ai")
const systemInstruction = require("./systemInstruction")
const ROUTER_ADDRESS = "0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2"
const FACTORY_ADDRESS = "0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf"
const config = require("./config")

async function main() {
    const provider = new ethers.JsonRpcProvider(config.RPC_URL)
    const wallet = new ethers.Wallet(config.PRIVATE_KEY, provider)
    const competition = new ethers.Contract(config.COMPETITION_ADDRESS, competitionAbi, wallet)
    const router = new ethers.Contract(ROUTER_ADDRESS, routerAbi, wallet)
    const factory = new ethers.Contract(FACTORY_ADDRESS, factoryAbi, wallet)
    const periphery = new ethers.Contract(config.PERIPHERY_ADDRESS, peripheryAbi, wallet)
    const gas = config.gas
    const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        systemInstruction: systemInstruction
    })

    const usdm = new ethers.Contract(await competition.USDM(), erc20Abi, wallet)
    const usdmAllowance = ethers.formatEther(await usdm.allowance(wallet.address, ROUTER_ADDRESS))
    if (usdmAllowance < 1e40) {
        await usdm.approve(ROUTER_ADDRESS, ethers.MaxUint256, gas)
        console.log("Approved router for USDM")
    }

    let newRound = false
    while (true) {
        const currentToken = await periphery.currentToken(config.COMPETITION_ADDRESS)
        if (currentToken === ethers.ZeroAddress) {
            console.log("Waiting for round to start...")
            await new Promise(resolve => setTimeout(resolve, 5000))
            newRound = true
            continue
        }

        const token = new ethers.Contract(currentToken, erc20Abi, wallet)
        if (newRound) {
            sendDiscordMessage(`New Round: ${currentToken}`)
            await token.approve(ROUTER_ADDRESS, ethers.MaxUint256, gas)
            console.log(`Approved router for ${currentToken}`)
            newRound = false
        } else {
            const tokenAllowance = ethers.formatEther(await token.allowance(wallet.address, ROUTER_ADDRESS))
            if (tokenAllowance < 1e40) {
                await token.approve(ROUTER_ADDRESS, ethers.MaxUint256, gas)
                console.log(`Approved router for ${currentToken}`)
            }
        }
        const pairAddress = await factory.getPair(currentToken, usdm.target)

        // Trading loop
        let priceHistory = []
        let tradeHistory = []
        while (true) {
            const latestCurrentToken = await periphery.currentToken(config.COMPETITION_ADDRESS)
            if (latestCurrentToken !== currentToken) {
                console.log("Round ended, exiting trading loop.")
                newRound = true
                break
            }

            const [usdmBalance, tokenBalance, usdmLP, tokenLP] = await Promise.all([
                balanceOf(wallet.address, usdm.target),
                balanceOf(wallet.address, currentToken),
                balanceOf(pairAddress, usdm.target),
                balanceOf(pairAddress, currentToken)
            ])

            const price = usdmLP / tokenLP
            priceHistory.push(price)

            let info = `You own ${tokenBalance.toFixed(5)} TOKEN and ${usdmBalance.toFixed(5)} USD.\n`
            info += `The liquidity pool has ${tokenLP.toFixed(5)} TOKEN and ${usdmLP.toFixed(5)} USD.\n`
            info += `TOKEN is currently trading at $${price.toFixed(5)}.\n`
            info += `The price history is:\n`
            for (let i = 0; i < priceHistory.length; i++) {
                info += `  hour ${i + 1}: $${priceHistory[i].toFixed(5)}\n`
            }
            if (tradeHistory.length == 0) {
                info += "This is your first trade. Your trade history is empty.\n"
            } else {
                info += `Your trade history is:\n`
                for (let i = 0; i < tradeHistory.length; i++) {
                    info += `  hour ${i + 1}: ${tradeHistory[i]}\n`
                }
            }

            const fileArgs = (await fs.readFile("prompt.txt", "utf8")).split(" // multiplier")
            const multiplier = fileArgs[0] * 0.999
            const promptTemplate = fileArgs[1]

            const prompt = promptTemplate
                .replace("{usdmBalance}", usdmBalance.toFixed(4))
                .replace("{tokenBalance}", tokenBalance.toFixed(4))
                + "\n" + info

            const decision = await getTradeDecision(model, prompt)
            const { action, percentage } = decision
            tradeHistory.push(`Action: ${action}, Percentage: ${percentage}`)

            let inputToken, outputToken, amountIn
            if (action.toLowerCase() === "buy") {
                inputToken = usdm.target
                outputToken = currentToken
                amountIn = usdmBalance * percentage / 100 * multiplier
            } else {
                inputToken = currentToken
                outputToken = usdm.target
                amountIn = tokenBalance * percentage / 100 * multiplier
            }

            if (amountIn < 0.00001) {
                console.log("Insufficient balance...")
                await new Promise(resolve => setTimeout(resolve, 4000))
                continue
            }

            const path = [inputToken, outputToken]
            const amountOutMin = 0
            const deadline = ethers.MaxUint256
            try {
                const tx = await router.swapExactTokensForTokens(
                    parseEther(amountIn),
                    amountOutMin,
                    path,
                    wallet.address,
                    deadline,
                    gas
                )
                await tx.wait()
                console.log(`${action}: Swapped ${amountIn} ${action === "buy" ? "USDM" : "Token"}`)
            } catch (error) {
                console.error(`Swap failed: ${error.message}`)
            }

            await new Promise(resolve => setTimeout(resolve, 4000))
        }
    }
}

function parseEther(amount) {
    return ethers.parseEther(amount.toFixed(18))
}

main().catch(error => {
    console.error(error)
})