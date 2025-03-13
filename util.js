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

async function sendDiscordMessage(message, username = 'Trading Competition', avatarUrl) {
    const payload = {
        content: message,
        username,
        avatar_url: avatarUrl
    };

    try {
        await axios.post(config.WEBHOOK_URL, payload);
    } catch (error) {
        console.error('Error sending discord message:', error);
    }
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
    console.log("prompt", prompt)
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

module.exports = {
    balanceOf,
    sendDiscordMessage,
    getTradeDecision
}