import type {
  RebalanceQuote,
  RebalancerMarketState,
  RebalancerOutcomeMetrics,
  RebalancerPosition
} from "./types.js";

export interface RebalancerVenueProvider {
  readonly id: string;
  getPosition(positionId: string): Promise<RebalancerPosition>;
  getMarketState(position: RebalancerPosition): Promise<RebalancerMarketState>;
  quoteRebalance(input: {
    position: RebalancerPosition;
    market: RebalancerMarketState;
    targetTickLower: number;
    targetTickUpper: number;
    maxSlippageBps: number;
    quoteTtlSeconds: number;
  }): Promise<RebalanceQuote>;
}

export interface RebalancerPerformanceProvider {
  readonly id: string;
  measure(input: {
    positionId: string;
    receiptId: string;
    baselineRef?: string;
  }): Promise<{
    measuredAt: string;
    metrics: RebalancerOutcomeMetrics;
    evidenceRefs: string[];
  }>;
}

export interface RebalancerFeeModel {
  readonly id: string;
  estimateFeeImprovementUsd(input: {
    position: RebalancerPosition;
    market: RebalancerMarketState;
    targetTickLower: number;
    targetTickUpper: number;
  }): Promise<number>;
}

export interface RebalancerRiskModel {
  readonly id: string;
  estimateImpermanentLossDeltaUsd(input: {
    position: RebalancerPosition;
    market: RebalancerMarketState;
    targetTickLower: number;
    targetTickUpper: number;
  }): Promise<number>;
}
