const { ethers } = require("ethers")
const axios = require('axios');
const { competitionAbi, erc20Abi, routerAbi } = require('./abi')
const config = require('./config')
const provider = new ethers.JsonRpcProvider(config.RPC_URL)

async function balanceOf(owner, token) {
    let output
    if (token) {
        const Token = new ethers.Contract(token, erc20Abi, provider)
        output = await Token.balanceOf(owner)
    } else {
        output = await provider.getBalance(owner)
    }
    return Number(ethers.formatEther(output))
}

const generationConfig = {
    temperature: 2,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192,
    responseMimeType: "application/json",
    responseSchema: {
        type: "object",
        properties: {
            action: {
                type: "string"
            },
            percentage: {
                type: "number"
            }
        }
    },
};
async function getTradeDecision(model, prompt) {
    try {
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig
        });
        const response = await result.response
        const decision = JSON.parse(response.text())
        if (decision.action && decision.percentage) {
            return decision
        }
    } catch (error) {
        console.error("Error getting AI decision:", error)
    }
    // Fallback to random if AI fails
    return {
        action: Math.random() > 0.5 ? "buy" : "sell",
        percentage: Math.floor(Math.random() * 10) + 1
    }
}

function estimatePriceImpact(poolUSD, poolToken, userBalance, percentage, isBuy) {
    const k = poolUSD * poolToken;
    const fee = 0.997; // Uniswap V2 fee multiplier (1 - 0.003)
    let newPoolUSD, newPoolToken;

    if (isBuy) { // Buying Token with USD
        const amountUSDIn = userBalance * (percentage / 100);
        if (amountUSDIn <= 0 || poolUSD <= 0) return null; // Avoid invalid calculations
        newPoolUSD = poolUSD + amountUSDIn * fee; // Add USD (approx fee adjust)
        if (newPoolUSD <= 0) return null;
        newPoolToken = k / newPoolUSD; // Calculate new Token reserve
    } else { // Selling Token for USD
        const amountTokenIn = userBalance * (percentage / 100);
        if (amountTokenIn <= 0 || poolToken <= 0) return null; // Avoid invalid calculations
        newPoolToken = poolToken + amountTokenIn * fee; // Add Token (approx fee adjust)
        if (newPoolToken <= 0) return null;
        newPoolUSD = k / newPoolToken; // Calculate new USD reserve
    }
    if (newPoolToken <= 0) return null; // Avoid division by zero
    return newPoolUSD / newPoolToken; // Return the new price
}

function parseEther(n) {
    return ethers.parseEther(n.toFixed(18));
}
module.exports = {
    balanceOf,
    getTradeDecision,
    estimatePriceImpact,
    parseEther,
}