import type { NavigatorScreenParams } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { Assessment, Insight, InsightAlternative, ManufacturerInfo, ProductResult, QuickInsight } from "./api/types";

export type TabParamList = {
  Scan: undefined;
  Search: undefined;
  /** comparisonId: reopen a stored comparison from History */
  Compare: { comparisonId?: string } | undefined;
  History: undefined;
  Profile: undefined;
};

export interface RefineParams {
  /** what the photo added ("složení", "nutriční hodnoty"…); empty = nothing new, keep everything */
  added: string[];
  /** history entry of the product before the photo */
  replaces: string;
  quick?: QuickInsight;
  insight?: Insight;
  /** the assessment shown before the photo (AI-adjusted) */
  assessment: Assessment;
}

export type RootStackParamList = {
  Onboarding: undefined;
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  Result: {
    result: ProductResult;
    /** already known insight (reopened from history) – no new request */
    insight?: Insight;
    /** already known quick opinion (reopened from history) – no new request */
    quick?: QuickInsight;
    /** opened from an alternative – insight loads only when the user opens the AI card */
    fromAlternative?: boolean;
    /** a supplementary photo refined the product on the previous screen: carry its opinions over */
    refine?: RefineParams;
    /** the same product was analysed before: this screen shows the stored result; `fresh` re-analyses */
    reused?: { at: string; fresh: ProductResult };
  };
  Manufacturer: { result: ProductResult; manufacturer?: ManufacturerInfo };
  Alternatives: { result: ProductResult; aiAlternatives?: InsightAlternative[] };
  ManualEntry: { initialName?: string } | undefined;
  ServerSettings: undefined;
};

export type RootNavigation = NativeStackNavigationProp<RootStackParamList>;
