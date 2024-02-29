import { createFileRoute } from "@tanstack/react-router";
import { DetailPage } from "@/pages/DetailPage.tsx";

export const Route = createFileRoute("/search/jga-dac/$id")({
  component: Detail,
});
function Detail() {
  return <DetailPage />;
}
