import type {
  CanaryProvider,
  FinancialAgentStrategy,
  FinancialExecutionProvider,
  RiskGateProvider,
  StrategyRunContext
} from "./interfaces.js";
import { evaluateExecutionReadiness } from "./gates.js";
import type {
  CanaryResult,
  EvidencePacket,
  ExecutableQuote,
  ExecutionReadiness,
  ExecutionReceipt,
  KernelRiskPolicy,
  ObservationSnapshot,
  OutcomeRecord,
  StrategyProposal
} from "./types.js";

export interface KernelRunResult {
  context: StrategyRunContext;
  observation: ObservationSnapshot;
  evidence: EvidencePacket;
  proposal: StrategyProposal;
  quote: ExecutableQuote | null;
  refreshedObservation: ObservationSnapshot;
  securityVetoes: string[];
  policyVetoes: string[];
  canary?: CanaryResult;
  readiness: ExecutionReadiness;
  receipt?: ExecutionReceipt;
}

export interface FinancialAgentKernelOptions {
  strategy: FinancialAgentStrategy;
  policy: KernelRiskPolicy;
  securityGate?: RiskGateProvider;
  policyGate?: RiskGateProvider;
  canary?: CanaryProvider;
  executor?: FinancialExecutionProvider;
  clock?: () => string;
}

export class FinancialAgentKernel {
  private readonly clock: () => string;

  constructor(private readonly options: FinancialAgentKernelOptions) {
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  async run(context: StrategyRunContext): Promise<KernelRunResult> {
    const observation = await this.options.strategy.observe(context);
    const evidence = await this.options.strategy.investigate({ context, observation });
    const proposal = await this.options.strategy.propose({ context, observation, evidence });

    if (proposal.agentId !== context.agentId) {
      throw new Error("STRATEGY_AGENT_MISMATCH");
    }
    if (proposal.category !== this.options.strategy.category) {
      throw new Error("STRATEGY_CATEGORY_MISMATCH");
    }
    if (proposal.mode !== context.mode) {
      throw new Error("STRATEGY_MODE_MISMATCH");
    }
    if (proposal.evidencePacketRef !== evidence.id || proposal.evidenceSnapshotRoot !== evidence.evidenceRoot) {
      throw new Error("STRATEGY_EVIDENCE_MISMATCH");
    }

    const quote = proposal.disposition === "propose"
      ? await this.options.strategy.quote({ context, observation, evidence, proposal })
      : null;

    if (quote && quote.proposalId !== proposal.id) {
      throw new Error("QUOTE_PROPOSAL_MISMATCH");
    }

    const refreshedObservation = await this.options.strategy.refresh({
      context,
      proposal,
      previousObservation: observation
    });

    const securityResult = this.options.securityGate
      ? await this.options.securityGate.evaluate({
          context,
          observation: refreshedObservation,
          evidence,
          proposal,
          quote
        })
      : { vetoes: [] as string[] };

    const policyResult = this.options.policyGate
      ? await this.options.policyGate.evaluate({
          context,
          observation: refreshedObservation,
          evidence,
          proposal,
          quote
        })
      : { vetoes: [] as string[] };

    let canary: CanaryResult | undefined;
    if (
      proposal.mode === "execute"
      && proposal.disposition === "propose"
      && quote
      && this.options.policy.requireCanaryForExecute
      && this.options.canary
    ) {
      canary = await this.options.canary.run({ context, proposal, quote });
    }

    const readiness = evaluateExecutionReadiness({
      now: this.clock(),
      proposal,
      quote,
      refreshedObservation,
      policy: this.options.policy,
      securityVetoes: securityResult.vetoes,
      policyVetoes: policyResult.vetoes,
      authorityRef: context.authorityRef,
      canary
    });

    let receipt: ExecutionReceipt | undefined;
    if (proposal.mode === "execute" && readiness.eligible) {
      if (!quote) throw new Error("READY_WITHOUT_QUOTE");
      if (!context.authorityRef) throw new Error("READY_WITHOUT_AUTHORITY");
      if (!this.options.executor) throw new Error("EXECUTION_PROVIDER_REQUIRED");

      receipt = await this.options.executor.execute({
        context,
        proposal,
        quote,
        authorityRef: context.authorityRef,
        canary
      });
    }

    return {
      context,
      observation,
      evidence,
      proposal,
      quote,
      refreshedObservation,
      securityVetoes: securityResult.vetoes,
      policyVetoes: policyResult.vetoes,
      canary,
      readiness,
      receipt
    };
  }

  async measure(input: {
    context: StrategyRunContext;
    receipt: ExecutionReceipt;
    baselineRef?: string;
  }): Promise<OutcomeRecord> {
    return this.options.strategy.measure(input);
  }
}
