import { Dashboard } from "@/components/Dashboard";
import { getPublicState } from "@/lib/public-state";

// Rebuilt at most once a minute; the page then polls /api/latest on its own.
export const revalidate = 60;

export default async function Home() {
  const initial = await getPublicState();
  return <Dashboard initial={initial} />;
}
