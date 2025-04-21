const { ethers } = require("ethers");
const { competitionAbi, erc20Abi, routerAbi, peripheryAbi } = require("./abi");
const { getTradeDecision, estimatePriceImpact, parseEther } = require("./util");
const fs = require("fs").promises;
const { GoogleGenerativeAI } = require("@google/generative-ai");
const systemInstruction = require("./systemInstruction");

const ROUTER_ADDRESS = "0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2";
const config = require("./config");

async function main() {
    const provider = new ethers.JsonRpcProvider(config.RPC_URL);
    const wallet = new ethers.Wallet(config.PRIVATE_KEY, provider);
    const competition = new ethers.Contract(
        config.COMPETITION_ADDRESS,
        competitionAbi,
        wallet
    );
    const router = new ethers.Contract(ROUTER_ADDRESS, routerAbi, wallet);
    const periphery = new ethers.Contract(
        config.PERIPHERY_ADDRESS,
        peripheryAbi,
        wallet
    );

    const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        systemInstruction,
    });

    const usdm = new ethers.Contract(await competition.USDM(), erc20Abi, wallet);

    let newRound = false;

    while (true) {
        const [tokenAddr] = await periphery.mmInfo(
            config.COMPETITION_ADDRESS,
            wallet.address
        );

        if (tokenAddr === ethers.ZeroAddress) {
            console.log("Waiting for round to start…");
            await delay(4000);
            newRound = true;
            continue;
        }

        if (newRound) {
            console.log("New Round " + tokenAddr);
            newRound = false;
        }

        // ----- Trading loop for the current round -----
        const priceHistory = [];
        const tradeHistory = [];
        const historyLookback = 10; // How many past hours of prices/trades to show LLM

        while (true) { // Inner loop (executes trades every hour within a round)
            let currentTokenAddr = ethers.ZeroAddress; // Initialize to check later
            let usdmBalRaw, tokenBalRaw, usdmLpRaw, tokenLpRaw;

            try {
                [currentTokenAddr, usdmBalRaw, tokenBalRaw, usdmLpRaw, tokenLpRaw] =
                    await periphery.mmInfo(config.COMPETITION_ADDRESS, wallet.address);
            } catch (error) {
                console.error("Error fetching mmInfo:", error);
                await delay(2000); // Wait before retrying
                continue; // Skip this iteration on error
            }


            // --- Round ended check ---
            if (currentTokenAddr !== tokenAddr || currentTokenAddr === ethers.ZeroAddress) {
                console.log(`Round ended. Exiting trading loop.`);
                try {
                    console.log("Attempting to end round...");
                    const tx = await competition.endRound({
                        ...config.gas,
                        gasLimit: 10000000
                    });
                    console.log("End round transaction sent:", tx.hash);
                    const receipt = await tx.wait();
                    if (receipt && receipt.status === 1) {
                        console.log("Successfully ended round. TX:", receipt.transactionHash);
                    } else {
                        console.log("ERROR: Failed to end round. TX Status:", receipt ? receipt.status : 'N/A');
                    }
                } catch (endRoundError) {
                    console.error("Error sending endRound transaction:", endRoundError);
                } finally {
                    newRound = true;
                    break;
                }
            }

            const usdmBalance = Number(ethers.formatEther(usdmBalRaw));
            const tokenBalance = Number(ethers.formatEther(tokenBalRaw));
            const usdmLP = Number(ethers.formatEther(usdmLpRaw));
            const tokenLP = Number(ethers.formatEther(tokenLpRaw));

            if (tokenLP <= 0 || usdmLP <= 0) {
                console.log("Warning: Pool liquidity is zero or negative. Skipping price calculation and trade.");
                await delay(2000);
                continue;
            }
            const price = usdmLP / tokenLP;
            priceHistory.push(price);

            let info = `## Current Situation\n`;
            info += `Your Balances: ${tokenBalance.toFixed(2)} TOKEN, ${usdmBalance.toFixed(2)} USD.\n`;
            info += `Pool Liquidity: ${tokenLP.toFixed(2)} TOKEN, ${usdmLP.toFixed(2)} USD.\n`;
            info += `Current Price: $${price.toFixed(5)}\n\n`;

            info += `## Price History (Last ${Math.min(historyLookback, priceHistory.length)} hours):\n`;
            const recentPrices = priceHistory.slice(-historyLookback);
            if (recentPrices.length > 0) {
                recentPrices.forEach(
                    (p, i) => info += `  Hour ${priceHistory.length - recentPrices.length + i + 1}: $${p.toFixed(5)}\n`
                );
            } else {
                info += `  No price history available for this round yet.\n`;
            }
            info += `\n`;

            info += `## Your Trade History (Last ${Math.min(historyLookback, tradeHistory.length)} trades):\n`;
            const recentTrades = tradeHistory.slice(-historyLookback);
            if (recentTrades.length === 0) {
                info += `  No prior trades in this round.\n`;
            } else {
                recentTrades.forEach((t, i) => info += `  Hour ${tradeHistory.length - recentTrades.length + i + 1}: ${t}\n`);
            }
            info += `\n`;

            const percents = [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10];
            for (percent of percents) {
                const estPriceImpactBuy = estimatePriceImpact(usdmLP, tokenLP, usdmBalance, percent, true);
                const estPriceImpactSell = estimatePriceImpact(usdmLP, tokenLP, tokenBalance, percent, false);
                info += `## Trade Impact for a ${percent}% trade\n`;
                info += `  After ${percent}% Buy: ${estPriceImpactBuy !== null ? '$' + estPriceImpactBuy.toFixed(5) : 'Calculation Error or N/A'}\n`;
                info += `  After ${percent}% Sell: ${estPriceImpactSell !== null ? '$' + estPriceImpactSell.toFixed(5) : 'Calculation Error or N/A'}\n`;
            }
            info += `## Your Task\n`;
            info += `Analyze the current situation, history, and estimated price impact.\n`;
            info += `Decide the optimal action (buy or sell) and the percentage (0-100) of the relevant balance (USD for buy, TOKEN for sell) to trade this hour.\n`;
            info += `Consider the price impact - large percentages may lead to significant slippage.\n`;
            info += `Respond ONLY in the format: Action: [buy|sell], Percentage: [number]\n`;


            // --- Console Logging for Debugging ---
            console.log(`\n--- Round Hour ${tradeHistory.length + 1} ---`);
            console.log(`Balances: $${usdmBalance.toFixed(0)}, ${tokenBalance.toFixed(0)} TOKEN`);
            console.log(`Pool: $${usdmLP.toFixed(0)}, ${tokenLP.toFixed(0)} TOKEN`);
            console.log(`$${price.toFixed(3)}`);
            console.log(`-----------------------------`);


            // --- Prepare and Send Prompt to LLM ---
            let promptTemplate = ""; // Default empty template
            let multiplier = 1.0; // Default multiplier

            try {
                // Read prompt template and multiplier - consider making multiplier optional
                const promptFileContent = await fs.readFile("prompt.txt", "utf8");
                const parts = promptFileContent.split(" // multiplier");
                promptTemplate = parts[1].trim(); // The main template text
                if (parts.length > 1 && !isNaN(parseFloat(parts[0]))) {
                    multiplier = parseFloat(parts[0]);
                } else {
                    console.log("Multiplier not found or invalid in prompt.txt, using default 1.0");
                }
                // Apply safety multiplier mentioned in original code
                multiplier *= 0.999;

            } catch (err) {
                console.warn("Could not read or parse prompt.txt. Using default empty template and multiplier. Error:", err.message);
                // Optionally define a default prompt template here if the file is essential
                promptTemplate = "You are a trading bot. Analyze the context and decide the trade."; // Basic fallback
            }


            const finalPrompt = promptTemplate + "\n\n" + info; // Combine template with dynamic info

            let action = "buy"; // Default action
            let percentage = 0; // Default percentage (no trade)

            try {
                const tradeDecisionResult = await getTradeDecision(model, finalPrompt); // Call your LLM function
                action = tradeDecisionResult.action;
                percentage = tradeDecisionResult.percentage;
                // Validate percentage
                if (isNaN(percentage) || percentage < 0 || percentage > 100) {
                    console.warn(`LLM returned invalid percentage: ${tradeDecisionResult.percentage}. Defaulting to 0.`);
                    percentage = 0;
                }
            } catch (llmError) {
                console.error("Error getting trade decision from LLM:", llmError);
                console.log("Defaulting to no trade (percentage 0) due to LLM error.");
                percentage = 0; // Ensure no trade happens if LLM fails
            }


            // Add the decision to history *before* executing the trade
            const tradeDesc = `Action: ${action}, Percentage: ${percentage}`;
            tradeHistory.push(tradeDesc);
            console.log(`LLM Decision: ${tradeDesc}`);

            // --- Execute Trade ---
            if (percentage > 0) { // Only proceed if percentage is positive
                const isBuy = action.toLowerCase() === "buy";
                const balanceToCheck = isBuy ? usdmBalance : tokenBalance;
                const amountInDecimal = balanceToCheck * (percentage / 100) * multiplier;

                // Add a minimum trade size check (e.g., avoid dust trades)
                const minTradeValue = 0.0001; // Minimum USD or Token amount to trade
                if (amountInDecimal < minTradeValue) {
                    console.log(`Skipping trade: Calculated amount ${amountInDecimal.toFixed(6)} is below minimum threshold ${minTradeValue}.`);
                    await delay(2000); // Wait before next cycle
                    continue;
                }

                const path = [
                    isBuy ? usdm.target : tokenAddr, // Input token
                    isBuy ? tokenAddr : usdm.target, // Output token
                ];
                const amountInBigInt = parseEther(amountInDecimal); // Convert decimal to BigInt wei
                const amountOutMin = 0; // Allow maximum slippage (consider setting a limit later)
                const deadline = Math.floor(Date.now() / 1000) + 60 * 10; // 10 minutes from now

                try {
                    const tx = await router.swapExactTokensForTokens(
                        amountInBigInt,
                        amountOutMin,
                        path,
                        wallet.address,
                        deadline,
                        config.gas // Use gas settings from config
                    );
                    const receipt = await tx.wait();
                    if (receipt && receipt.status === 1) {
                        console.log(
                            `${action.toUpperCase()}: Swapped ~${amountInDecimal.toFixed(4)} ${isBuy ? "USDM" : "TOKEN"}`
                        );
                    } else {
                        console.log(
                            `TX FAILED: ${action.toUpperCase()} swap failed. Amount: ~${amountInDecimal.toFixed(4)} ${isBuy ? "USDM" : "TOKEN"}. Status: ${receipt ? receipt.status : 'N/A'}`
                        );
                    }
                } catch (swapError) {
                    console.error(`Swap execution failed: ${swapError.message}`);
                    // Consider logging more details from swapError if available
                }
            } else {
                console.log("Percentage is 0, skipping trade execution.");
            }

            await delay(2000); // Wait 2 seconds before the next iteration
        } // End of inner trading loop
    } // End of outer round loop
}

function delay(ms) {
    return new Promise((res) => setTimeout(res, ms));
}

main().catch(console.error);
