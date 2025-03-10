export const competitionAbi = [
    "function currentToken() view returns (address)",
    "function USDM() view returns (address)"
];

export const erc20Abi = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address, uint256) returns (bool)",
    "function allowance(address, address) view returns (uint256)"
];

export const routerAbi = [
    "function getAmountsOut(uint256, address[]) view returns (uint256[])",
    "function swapExactTokensForTokens(uint256, uint256, address[], address, uint256) returns (uint256[])"
];

export const factoryAbi = [
    "function getPair(address, address) view returns (address)"
];