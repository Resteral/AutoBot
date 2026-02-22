require('dotenv').config();
const { ethers } = require('ethers');

// Load configurations
const RPC_URL = process.env.RPC_URL;
const SECRET_PHRASE = process.env.SECRET_PHRASE; // 12-word phrase
const BASE_TOKEN = process.env.BASE_TOKEN;     // WBNB or WETH
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS;

if (!RPC_URL || !SECRET_PHRASE || !BASE_TOKEN || !ROUTER_ADDRESS || !FACTORY_ADDRESS) {
    console.error("ENVIRONMENT VARIABLE ERROR: One or more configuration variables are missing.");
    console.error(`- RPC_URL: ${RPC_URL ? 'FOUND' : 'MISSING'}`);
    console.error(`- SECRET_PHRASE: ${SECRET_PHRASE ? 'FOUND' : 'MISSING'}`);
    console.error(`- BASE_TOKEN: ${BASE_TOKEN ? 'FOUND' : 'MISSING'}`);
    console.error(`- ROUTER_ADDRESS: ${ROUTER_ADDRESS ? 'FOUND' : 'MISSING'}`);
    console.error(`- FACTORY_ADDRESS: ${FACTORY_ADDRESS ? 'FOUND' : 'MISSING'}`);
    process.exit(1);
}

// 1. Initialize Setup
const provider = new ethers.JsonRpcProvider(RPC_URL);

// 2. Connect Wallet
// This wallet instance can sign transactions on behalf of the TrustWallet account
const wallet = ethers.Wallet.fromPhrase(SECRET_PHRASE, provider);

console.log(`Bot connected with TrustWallet account: ${wallet.address}`);

// ABIs
const factoryABI = [
    "event PairCreated(address indexed token0, address indexed token1, address pair, uint)"
];

const routerABI = [
    "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
    "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)"
];

const factoryContract = new ethers.Contract(FACTORY_ADDRESS, factoryABI, provider);
const routerContract = new ethers.Contract(ROUTER_ADDRESS, routerABI, wallet);

// amountIn: Amount of BNB/WBNB you want to spend per snipe
// We default to 0.005 BNB so it works with smaller test balances, but you can override it in Railway
const buyAmountValue = process.env.BUY_AMOUNT || '0.005';
const amountIn = ethers.parseUnits(buyAmountValue, 18);

async function buyToken(targetToken) {
    try {
        console.log(`Attempting to buy ${targetToken} using ${BASE_TOKEN}...`);

        // Slippage tolerance (setting 0 is dangerous in production, but we want the simplest example)
        const amountOutMin = 0;

        // Path of the swap
        const path = [BASE_TOKEN, targetToken];

        // Deadline: 10 minutes from now
        const deadline = Math.floor(Date.now() / 1000) + 60 * 10;

        // Execute the swap (assuming we are sending native BNB)
        console.log("Sending transaction to DEX Router...");
        const tx = await routerContract.swapExactETHForTokens(
            amountOutMin,
            path,
            wallet.address,
            deadline,
            {
                value: amountIn,
                // Optional: set custom gas parameters to "snipe" faster
                // maxFeePerGas: ethers.parseUnits('5', 'gwei'),
                // maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei'),
            }
        );

        console.log(`Transaction sent! Transaction hash: ${tx.hash}`);

        // Wait for the transaction to be mined
        const receipt = await tx.wait();
        console.log(`Transaction successful in block ${receipt.blockNumber}`);
    } catch (error) {
        console.error("Error executing swap:", error.message);
    }
}

// 3. Listen for Pairs
async function startBot() {
    console.log(`Listening for new liquidity pools on Factory ${FACTORY_ADDRESS}...`);

    factoryContract.on("PairCreated", async (token0, token1, pairAddress) => {
        console.log(`\n--- NEW PAIR DETECTED ---`);
        console.log(`Token0: ${token0}`);
        console.log(`Token1: ${token1}`);
        console.log(`Pair Contract Address: ${pairAddress}`);

        // 4. Check if the newly created pair contains our BASE_TOKEN (e.g., WBNB)
        let targetToken = null;
        if (token0.toLowerCase() === BASE_TOKEN.toLowerCase()) {
            targetToken = token1;
        } else if (token1.toLowerCase() === BASE_TOKEN.toLowerCase()) {
            targetToken = token0;
        }

        if (targetToken) {
            console.log(`Match found! Base Token is present. New Token to Snipe: ${targetToken}`);
            // Execute the buy
            await buyToken(targetToken);
        } else {
            console.log(`Ignored Pair: Neither token matches our BASE_TOKEN (${BASE_TOKEN}).`);
        }
    });
}

// Start the listener
startBot();
