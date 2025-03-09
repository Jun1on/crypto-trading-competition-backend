const { ethers } = require("ethers")
const { competitionAbi, erc20Abi, routerAbi } = require('./abi')
const { balanceOf } = require('./util')
const ROUTER_ADDRESS = "0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2"
const config = require('./config')

async function main() {
    const provider = new ethers.JsonRpcProvider(config.RPC_URL)
    const wallet = new ethers.Wallet(config.PRIVATE_KEY, provider)
    const competition = new ethers.Contract(config.COMPETITION_ADDRESS, competitionAbi, wallet)
    const router = new ethers.Contract(ROUTER_ADDRESS, routerAbi, wallet)
    const gas = config.gas

    const usdm = new ethers.Contract(await competition.USDM(), erc20Abi, wallet)
    const usdmAllowance = ethers.formatEther((await usdm.allowance(wallet.address, ROUTER_ADDRESS)))
    if (usdmAllowance < 1e40) {
        await usdm.approve(ROUTER_ADDRESS, ethers.MaxUint256, gas)
        console.log("Approved router for USDM")
    }

    let newRound = false
    while (true) {
        const currentToken = await competition.currentToken()
        if (currentToken === ethers.AddressZero) {
            console.log("Waiting for round to start...")
            await new Promise(resolve => setTimeout(resolve, 2000))
            newRound = true
            continue
        }

        const token = new ethers.Contract(currentToken, erc20Abi, wallet)
        if (newRound) {
            // todo: announce new round
            await token.approve(ROUTER_ADDRESS, ethers.MaxUint256, gas)
            console.log(`Approved router for ${currentToken}`)
            newRound = false
        } else {
            const tokenAllownace = ethers.formatEther((await token.allowance(wallet.address, ROUTER_ADDRESS)))
            if (tokenAllownace < 1e40) {
                await token.approve(ROUTER_ADDRESS, ethers.MaxUint256, gas)
                console.log(`Approved router for ${currentToken}`)
            }
        }

        // trading loop
        while (true) {
            const latestCurrentToken = await competition.currentToken()
            if (latestCurrentToken !== currentToken) {
                console.log("Round ended, exiting trading loop.")
                newRound = true
                break
            }

            const [usdmBalance, tokenBalance] = await Promise.all([
                balanceOf(wallet.address, usdm.target),
                balanceOf(wallet.address, currentToken)
            ]);

            let action
            if (true) {
                action = Math.random() > 0.5 ? "buy" : "sell"
            }

            const percentage = Math.floor(Math.random() * 10) + 1 // 1% to 10%
            let inputToken, outputToken, amountIn
            if (action === "buy") {
                inputToken = usdm.target
                outputToken = currentToken
                amountIn = usdmBalance * percentage / 100
            } else {
                inputToken = currentToken
                outputToken = usdm.target
                amountIn = tokenBalance * percentage / 100
            }

            if (amountIn < 0.0001) {
                console.log("Insufficient balance, waiting 15 seconds...")
                await new Promise(resolve => setTimeout(resolve, 15000))
                continue
            }

            console.log(5, ethers.parseEther("5"))

            const path = [inputToken, outputToken]
            const amountOutMin = 0 // 100% slippage
            const deadline = ethers.MaxUint256
            try {
                const tx = await router.swapExactTokensForTokens(
                    ethers.parseEther(amountIn.toString()),
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

            await new Promise(resolve => setTimeout(resolve, 15000))
        }
    }
}

main().catch(error => {
    console.error(error)
})