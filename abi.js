export const competitionAbi = [
    "function USDM() view returns (address)",
    "function endRound()"
];

export const peripheryAbi = [
    "function mmInfo(address, address) view returns (address token, uint256 usdmBalance, uint256 tokenBalance, uint256 usdmLP, uint256 tokenLP)"
]

export const erc20Abi = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address, uint256) returns (bool)",
    "function allowance(address, address) view returns (uint256)"
];

export const routerAbi = [
    "function getAmountsOut(uint256, address[]) view returns (uint256[])",
    "function swapExactTokensForTokens(uint256, uint256, address[], address, uint256) returns (uint256[])"
];