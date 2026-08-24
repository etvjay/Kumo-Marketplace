import { z } from "zod";

export const marketplaceCategorySchema = z.enum([
  "rebalancing",
  "grid-trading",
  "yield-optimisation",
  "health-factor-monitoring"
]);

export type MarketplaceCategory = z.infer<typeof marketplaceCategorySchema>;

export const REQUIRED_BNB_MARKETPLACE_CATEGORIES = marketplaceCategorySchema.options;
