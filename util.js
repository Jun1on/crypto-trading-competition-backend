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

module.exports = sendDiscordMessage;

module.exports = {
    balanceOf,
    sendDiscordMessage
}