import { Interface } from "@ethersproject/abi";
import { Provider } from "@ethersproject/abstract-provider";
import { AddressZero } from "@ethersproject/constants";
import { Contract } from "@ethersproject/contracts";
import { Protocol } from "@uniswap/router-sdk";
import {
  Currency,
  CurrencyAmount,
  Ether,
  Percent,
  Token,
  TradeType,
} from "@uniswap/sdk-core";
import { AlphaRouter, SwapType } from "@uniswap/smart-order-router";

import { FILLER, WETH2 } from "../../common/addresses";
import { Solution } from "../types";

const getToken = async (
  address: string,
  provider: Provider
): Promise<Currency> => {
  const contract = new Contract(
    address,
    new Interface(["function decimals() view returns (uint8)"]),
    provider
  );

  const chainId = await provider.getNetwork().then((n) => n.chainId);
  return [WETH2, AddressZero].includes(address)
    ? Ether.onChain(chainId)
    : new Token(chainId, address, await contract.decimals());
};

export const solve = async (
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  provider: Provider
): Promise<Solution | undefined> => {
  const chainId = await provider.getNetwork().then((n) => n.chainId);
  const router = new AlphaRouter({
    chainId,
    provider: provider as any,
  });

  const fromToken = await getToken(tokenIn, provider);
  const toToken = await getToken(tokenOut, provider);

  const route = await router.route(
    CurrencyAmount.fromRawAmount(fromToken, amountIn),
    toToken,
    TradeType.EXACT_INPUT,
    {
      type: SwapType.SWAP_ROUTER_02,
      recipient: FILLER,
      slippageTolerance: new Percent(5, 100),
      deadline: Math.floor(Date.now() / 1000 + 1800),
    },
    {
      protocols: [Protocol.V3],
      maxSwapsPerPath: 1,
      maxSplits: 1,
    }
  );

  const iface = new Interface([
    `function multicall(uint256 deadline, bytes[] calldata data)`,
    `
      function exactInputSingle(
        tuple(
          address tokenIn,
          address tokenOut,
          uint24 fee,
          address recipient,
          uint256 amountIn,
          uint256 amountOutMinimum,
          uint160 sqrtPriceLimitX96
        ) params
      )
    `,
  ]);

  try {
    // Properly handle multicall-wrapping
    let calldata = route!.methodParameters!.calldata;
    if (calldata.startsWith(iface.getSighash("multicall"))) {
      const decodedMulticall = iface.decodeFunctionData("multicall", calldata);
      for (const data of decodedMulticall.data) {
        if (data.startsWith(iface.getSighash("exactInputSingle"))) {
          return {
            to: route!.methodParameters!.to,
            data,
          };
        }
      }
    }
  } catch {
    throw new Error("Could not generate compatible route");
  }
};
