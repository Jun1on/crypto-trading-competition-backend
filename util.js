const { ethers } = require("ethers")
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

module.exports = {
    balanceOf
}