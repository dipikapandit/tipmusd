import type { DashboardOverview } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { getChain } from "@/lib/server/chain";
import { getOverview } from "@/lib/server/dashboard";
import { route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { sql }): Promise<DashboardOverview> => getOverview(sql, getChain(), await requireSession(sql, req)));
