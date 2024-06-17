import ccxt from 'ccxt';

interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const exchange = new ccxt.binance();
const timeframe = '5m';
const initialBalance = 1000;
const since = new Date('2024-01-01').getTime();
const threshold = 0.01;

async function fetchAllOHLCV(symbol: string, timeframe: string, since: number): Promise<OHLCV[]> {
  const limit = 1000;
  let allData: OHLCV[] = [];
  let fetchSince = since;

  while (true) {
    const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, fetchSince, limit);
    if (ohlcv.length === 0) break;

    const data = ohlcv.map(candle => ({
      timestamp: candle[0],
      open: candle[1],
      high: candle[2],
      low: candle[3],
      close: candle[4],
      volume: candle[5]
    } as OHLCV));

    allData = allData.concat(data);
    fetchSince = data[data.length - 1].timestamp + 1;

    if (ohlcv.length < limit) break;
  }

  return allData;
}

function detectPriceSpikes(data: OHLCV[], symbol: string): void {
  let currentBalance = initialBalance;
  let totalTrades = 0;
  let winningTrades = 0;
  let losingTrades = 0;
  let monthlyProfit: { [key: string]: number } = {};

  for (let i = 1; i < data.length; i++) {
    const previousPrice = data[i - 1].close;
    const currentPrice = data[i].close;
    const change = (currentPrice - previousPrice) / previousPrice;

    if (Math.abs(change) > threshold) {
      const isShort = change > 0;
      console.log(`[${isShort ? 'SHORT' : 'LONG'}] Price spike detected on ${new Date(data[i].timestamp).toLocaleString()} in ${symbol}! Previous: ${previousPrice}, Current: ${currentPrice}, Change: ${(change * 100).toFixed(2)}%, Volume: ${data[i].volume}`);
      const result = executeTrade(data, i, change, isShort, currentBalance, monthlyProfit);
      currentBalance = result.balance;
      totalTrades++;
      if (result.profit > 0) {
        winningTrades++;
      } else {
        losingTrades++;
      }
    }
  }

  console.log(`Final balance for ${symbol}: ${currentBalance.toFixed(2)}`);
  console.log(`Total trades for ${symbol}: ${totalTrades}`);
  console.log(`Winning trades for ${symbol}: ${winningTrades}`);
  console.log(`Losing trades for ${symbol}: ${losingTrades}`);
  console.log(`Win rate for ${symbol}: ${(winningTrades / totalTrades * 100).toFixed(2)}%`);
  console.log(`Monthly profit for ${symbol}:`);
  for (const month in monthlyProfit) {
    console.log(`${month}: ${monthlyProfit[month].toFixed(2)}`);
  }
}

function executeTrade(data: OHLCV[], index: number, change: number, isShort: boolean, currentBalance: number, monthlyProfit: { [key: string]: number }): { balance: number, profit: number } {
  const entryPrice = data[index].close;
  change = Math.abs(change);
  const targetPrice = isShort ? entryPrice - (change / 2) * entryPrice : entryPrice + (change / 2) * entryPrice;
  const stopLossPrice = isShort ? entryPrice + change * entryPrice : entryPrice - change * entryPrice;

  let positionOpened = true;
  let profit = 0;

  for (let i = index + 1; i < data.length; i++) {
    const currentPrice = isShort ? data[i].low : data[i].high;
    const month = new Date(data[i].timestamp).toISOString().slice(0, 7); // YYYY-MM

    if (isShort && currentPrice <= targetPrice) {
      profit = (entryPrice - currentPrice) / entryPrice * currentBalance;
      currentBalance += profit;
      monthlyProfit[month] = (monthlyProfit[month] || 0) + profit;
      console.log(`[SHORT WIN] Take profit hit on ${new Date(data[i].timestamp).toLocaleString()}! Entry: ${entryPrice}, Exit: ${currentPrice}, Profit: ${profit.toFixed(2)}, Balance: ${currentBalance.toFixed(2)}`);
      positionOpened = false;
      break;
    } else if (!isShort && currentPrice >= targetPrice) {
      profit = (currentPrice - entryPrice) / entryPrice * currentBalance;
      currentBalance += profit;
      monthlyProfit[month] = (monthlyProfit[month] || 0) + profit;
      console.log(`[LONG WIN] Take profit hit on ${new Date(data[i].timestamp).toLocaleString()}! Entry: ${entryPrice}, Exit: ${currentPrice}, Profit: ${profit.toFixed(2)}, Balance: ${currentBalance.toFixed(2)}`);
      positionOpened = false;
      break;
    }

    if ((isShort && currentPrice >= stopLossPrice) || (!isShort && currentPrice <= stopLossPrice)) {
      profit = Math.abs((currentPrice - entryPrice) / entryPrice * currentBalance);
      currentBalance -= profit;
      monthlyProfit[month] = (monthlyProfit[month] || 0) - profit;
      console.log(`[${isShort ? 'SHORT' : 'LONG'} LOSS] Stop loss hit on ${new Date(data[i].timestamp).toLocaleString()}! Entry: ${entryPrice}, Exit: ${currentPrice}, Loss: ${profit.toFixed(2)}, Balance: ${currentBalance.toFixed(2)}`);
      positionOpened = false;
      profit = -profit;
      break;
    }
  }

  if (positionOpened) {
    const lastPrice = data[data.length - 1].close;
    const lastChange = (lastPrice - entryPrice) / entryPrice * currentBalance;
    profit = isShort ? -lastChange : lastChange;
    currentBalance += profit;
    const month = new Date(data[data.length - 1].timestamp).toISOString().slice(0, 7); // YYYY-MM
    monthlyProfit[month] = (monthlyProfit[month] || 0) + profit;
    console.log(`Position closed at the end of data on ${new Date(data[data.length - 1].timestamp).toLocaleString()}. Entry: ${entryPrice}, Exit: ${lastPrice}, Balance: ${currentBalance.toFixed(2)}`);
  }

  return { balance: currentBalance, profit };
}

async function backtest(symbol: string) {
  const data = await fetchAllOHLCV(symbol, timeframe, since);
  console.log(`Total data points fetched for ${symbol}: ${data.length}`);
  detectPriceSpikes(data, symbol);
}

async function runBacktests() {
  const markets = await exchange.loadMarkets();
  const usdtSymbols = Object.keys(markets).filter((symbol) => symbol.endsWith('/USDT'));

  for (const symbol of usdtSymbols) {
    console.log(`Starting backtest for ${symbol}...`);
    await backtest(symbol);
  }
}

runBacktests().catch(console.error);