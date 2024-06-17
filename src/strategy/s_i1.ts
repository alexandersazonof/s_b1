import ccxt from 'ccxt';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const exchange = new ccxt.binance({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_API_SECRET,
});
const timeframe = '5m';
const threshold = 0.013; // 1.5% threshold
const orderAmount = 30; // USD amount to trade
const volumeThreshold = 10000000; // 10 million USD
const maxOrders = 10; // Maximum number of open orders

const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.CHAT_ID;

async function sendTelegramMessage(message: string) {
  const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
  const params = {
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown' // Use Markdown for formatting
  };
  await axios.post(url, params);
}

async function getBalance(currency: string): Promise<number> {
  const balance = await exchange.fetchBalance();
  // @ts-ignore
  return balance.free[currency];
}

async function fetchLatestOHLCV(symbol: string, timeframe: string): Promise<OHLCV[]> {
  const now = new Date();
  const since = now.getTime() - 2 * 5 * 60 * 1000;
  const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, since, 2);
  return ohlcv.map(candle => ({
    timestamp: candle[0],
    open: candle[1],
    high: candle[2],
    low: candle[3],
    close: candle[4],
    volume: candle[5]
  } as OHLCV));
}

async function placeOrder(symbol: string, side: 'buy' | 'sell', amountMarket: number, price: number, takeProfit: number, stopLoss: number) {
  try {
    const order = await exchange.createOrder(symbol, 'market', side, amountMarket);
    const amount = order.amount;

    const baseCurrency = symbol.split('/')[0];
    const baseBalance = await getBalance(baseCurrency);

    const message = `✅ *Order Placed* \nSymbol: *${symbol}*\nSide: *${side.toUpperCase()}*\nAmount: *${amount}*\nPrice: *${price}*\nTake Profit: *${takeProfit}*\nStop Loss: *${stopLoss}*\nBalance: *${baseBalance} ${baseCurrency}*`;
    console.log(message);
    await sendTelegramMessage(message);

    // Place take profit order
    const takeProfitOrder = await exchange.createOrder(symbol, 'limit', side === 'buy' ? 'sell' : 'buy', baseBalance, takeProfit);

    console.log(`Take profit order placed at ${takeProfit}, Stop loss order placed at ${stopLoss}`);
    await sendTelegramMessage(`📈 Take profit order placed at ${takeProfit}, Stop loss order placed at ${stopLoss}`);
  } catch (error) {
    console.error(`Error placing order for ${symbol}:`, error);
    await sendTelegramMessage(`❌ Error placing order for ${symbol}: ${error}`);
  }
}

async function get24hVolume(symbol: string): Promise<number> {
  const ticker = await exchange.fetchTicker(symbol);
  return ticker.quoteVolume || 0; // Assuming quoteVolume is in USD
}

async function getOpenOrdersCount(): Promise<number> {
  const openOrders = await exchange.fetchOpenOrders();
  return openOrders.length;
}

async function detectPriceSpikes(symbol: string): Promise<void> {
  const volume24h = await get24hVolume(symbol);
  if (volume24h < volumeThreshold) return; // Skip if volume is below threshold

  const data = await fetchLatestOHLCV(symbol, timeframe);
  if (data.length < 2) return; // Not enough data to compare

  const previousPrice = data[data.length - 2].close;
  const currentPrice = data[data.length - 1].close;
  const change = (currentPrice - previousPrice) / previousPrice;

  if (Math.abs(change) > threshold) {
    const isShort = change > 0;
    if (!isShort) {
      // const openOrdersCount = await getOpenOrdersCount();
      // if (openOrdersCount >= maxOrders) {
      //   console.log(`Max order limit reached. Cannot place more orders.`);
      //   await sendTelegramMessage(`⚠️ Max order limit reached. Cannot place more orders.`);
      //   return;
      // }

      const amount = orderAmount / currentPrice;
      const takeProfit = currentPrice * (1 + threshold);
      const stopLoss = currentPrice * (1 - threshold);
      await placeOrder(symbol, 'buy', amount, currentPrice, takeProfit, stopLoss);
    }
    const message = `[${isShort ? 'SHORT' : 'LONG'}] Price spike detected for ${symbol} on ${new Date(data[data.length - 1].timestamp).toLocaleString()}! Previous: ${previousPrice}, Current: ${currentPrice}, Change: ${(change * 100).toFixed(2)}%, Volume: ${data[data.length - 1].volume}`;
    console.log(message);
    // await sendTelegramMessage(message);
  }
}

async function monitorTickers() {
  const markets = await exchange.loadMarkets();
  const usdtSymbols = Object.keys(markets).filter(symbol => symbol.endsWith('/USDT'));

  for (const symbol of usdtSymbols) {
    try {
      await detectPriceSpikes(symbol);
    } catch (error) {
      console.error(`Error fetching data for ${symbol}:`, error);
    }
  }
}

async function runMonitoring() {
  while (true) {
    await monitorTickers();
  }
}

// Start monitoring
runMonitoring().catch(console.error);