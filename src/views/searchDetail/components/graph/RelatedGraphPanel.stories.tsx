import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";
import { bioproject1 } from "@/msw/data/bioproject1.ts";
import type { Xref } from "@/schema/api/detail/base.ts";
import { RelatedGraphPanel } from "./RelatedGraphPanel.tsx";

const ref = (identifier: string, type = "biosample"): Xref => ({
  identifier,
  type,
  url: `https://ddbj.nig.ac.jp/search/entry/${type}/${identifier}`,
});
const meta = {
  component: RelatedGraphPanel,
  args: { data: { ...bioproject1, identifier: "GRAPH_ROOT" } },
  decorators: [],
  beforeEach: () => {
    const original = globalThis.fetch;
    const mock = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (!url.includes("/entries/")) return original(input, init);
      if (url.includes("dbxrefs.json")) {
        const segments = url.split("/");
        const id = segments[segments.length - 2];
        const refs =
          id === "GRAPH_ROOT"
            ? [
                ref("GRAPH_A"),
                ref("GRAPH_B"),
                { identifier: "EXTERNAL", type: "assembly", url: "https://example.com/assembly" },
              ]
            : id === "GRAPH_A"
              ? [ref("GRAPH_ROOT", "bioproject"), ref("GRAPH_B"), ref("GRAPH_C")]
              : [];
        return Response.json({ dbXrefs: refs });
      }
      return Response.json({ title: "Graph sample title" });
    });
    return () => mock.mockRestore();
  },
} satisfies Meta<typeof RelatedGraphPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Primary = {
  play: async ({ canvasElement, canvas }) => {
    const nodes = () => canvasElement.querySelectorAll("g.node");
    await expect(canvas.getByRole("checkbox", { name: "Show IDs" })).not.toBeChecked();
    await waitFor(() => expect(nodes()).toHaveLength(4));
    await expect(canvas.getByRole("status")).toHaveTextContent("Loaded through level 1");
    await expect(
      canvas.getByRole("button", { name: "Select GRAPH_ROOT" }).querySelector("circle"),
    ).not.toHaveAttribute("fill", "#ffffff");
    await expect(
      canvas.getByRole("button", { name: "Select GRAPH_A" }).querySelector("circle"),
    ).toHaveAttribute("fill", "#ffffff");
    await expect(
      canvas.getByRole("button", { name: "Select EXTERNAL" }).querySelector("circle"),
    ).not.toHaveAttribute("fill", "#ffffff");
    const circle = canvasElement.querySelector("g.node circle")!;
    const compactRadius = Number(circle.getAttribute("r"));
    await userEvent.click(canvas.getByRole("checkbox", { name: "Show IDs" }));
    await waitFor(() => expect(Number(circle.getAttribute("r"))).toBeGreaterThan(compactRadius));
    await userEvent.click(canvas.getByRole("button", { name: "Select GRAPH_A" }));
    const summary = within(canvas.getByLabelText("Selected entry"));
    await expect(await summary.findByText("Graph sample title")).toBeInTheDocument();
    await expect(summary.getByRole("link", { name: "Open entry" })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Load next level" }));
    await waitFor(() => expect(nodes()).toHaveLength(5));
    await expect(canvas.getByRole("status")).toHaveTextContent("Loaded through level 2");
    await expect(
      canvas.getByRole("button", { name: "Select GRAPH_A" }).querySelector("circle"),
    ).not.toHaveAttribute("fill", "#ffffff");
    await expect(
      canvas.getByRole("button", { name: "Select GRAPH_C" }).querySelector("circle"),
    ).toHaveAttribute("fill", "#ffffff");
  },
} satisfies Story;

export const IndividualLoading = {
  play: async ({ canvasElement, canvas }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll("g.node")).toHaveLength(4));
    await userEvent.click(canvas.getByRole("button", { name: "Select GRAPH_A" }));
    const summary = within(canvas.getByLabelText("Selected entry"));
    await expect(summary.queryByLabelText("Related entry counts")).not.toBeInTheDocument();
    const collapse = summary.getByRole("checkbox", { name: "Hide connected branch" });
    await userEvent.click(collapse);
    await userEvent.click(summary.getByRole("button", { name: "Load related entries" }));
    await waitFor(() => expect(canvasElement.querySelectorAll("g.node")).toHaveLength(5));
    await expect(summary.getByRole("button", { name: "Related entries loaded" })).toBeDisabled();
    await expect(canvas.queryByRole("button", { name: "Select GRAPH_C" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Select GRAPH_A" })).toHaveAttribute(
      "opacity",
      "0.4",
    );
    await userEvent.click(collapse);
    await expect(canvas.getByRole("button", { name: "Select GRAPH_C" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Select GRAPH_A" })).toHaveAttribute(
      "opacity",
      "1",
    );
    const counts = within(summary.getByRole("table", { name: "Related entries by database" }));
    await expect(counts.getByRole("row", { name: "BioProject 1" })).toBeInTheDocument();
    await expect(counts.getByRole("row", { name: "BioSample 2" })).toBeInTheDocument();
    await expect(summary.getByRole("heading", { name: "Related entries (3)" })).toBeInTheDocument();
    await expect(canvas.getByRole("status")).toHaveTextContent("Loaded through level 1");
    await expect(
      canvas.getByRole("button", { name: "Select GRAPH_A" }).querySelector("circle"),
    ).not.toHaveAttribute("fill", "#ffffff");
    await expect(
      canvas.getByRole("button", { name: "Select GRAPH_B" }).querySelector("circle"),
    ).toHaveAttribute("fill", "#ffffff");
    await userEvent.click(canvas.getByRole("button", { name: "Load next level" }));
    await expect(canvas.getByRole("status")).toHaveTextContent("Loaded through level 2");
    await userEvent.click(canvas.getByRole("button", { name: "Select GRAPH_B" }));
    await expect(await canvas.findByText("No related entries.")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Select EXTERNAL" }));
    await expect(
      canvas.queryByRole("button", { name: "Load related entries" }),
    ).not.toBeInTheDocument();
  },
} satisfies Story;

export const DatabaseVisibility = {
  play: async ({ canvasElement, canvas }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll("g.node")).toHaveLength(4));
    const legend = within(canvas.getByLabelText("Database legend"));
    const biosample = legend.getByRole("checkbox", { name: "BioSample" });
    await expect(biosample).toBeChecked();
    await userEvent.click(canvas.getByRole("button", { name: "Select GRAPH_A" }));
    await expect(await canvas.findByLabelText("Selected entry")).toBeInTheDocument();
    await userEvent.click(biosample);
    await expect(canvas.queryByRole("button", { name: "Select GRAPH_A" })).not.toBeInTheDocument();
    await expect(canvas.queryByLabelText("Selected entry")).not.toBeInTheDocument();
    await expect(canvasElement.querySelectorAll("g.node")).toHaveLength(4);
    await expect(canvasElement.querySelectorAll('g.edges line[display="none"]')).toHaveLength(2);
    await expect(canvas.getByRole("status")).toHaveTextContent("2 visible nodes");
    await expect(canvas.getByRole("button", { name: "Load next level" })).toBeDisabled();
    await expect(canvas.queryByRole("button", { name: "Select GRAPH_C" })).not.toBeInTheDocument();
    await userEvent.click(biosample);
    await userEvent.click(canvas.getByRole("button", { name: "Load next level" }));
    await waitFor(() => expect(canvasElement.querySelectorAll("g.node")).toHaveLength(5));
    await expect(canvas.getByRole("button", { name: "Select GRAPH_C" })).toBeVisible();
    await expect(canvasElement.querySelectorAll('g.edges line[display="none"]')).toHaveLength(0);
    await userEvent.click(legend.getByRole("checkbox", { name: "External links" }));
    await expect(canvas.queryByRole("button", { name: "Select EXTERNAL" })).not.toBeInTheDocument();
    await expect(canvasElement.querySelectorAll('g.edges line[display="none"]')).toHaveLength(1);
  },
} satisfies Story;

export const SkipCollapsedLoading = {
  play: async ({ canvasElement, canvas }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll("g.node")).toHaveLength(4));
    await userEvent.click(canvas.getByRole("button", { name: "Select GRAPH_A" }));
    const collapse = canvas.getByRole("checkbox", { name: "Hide connected branch" });
    await userEvent.click(collapse);
    await userEvent.click(canvas.getByRole("button", { name: "Load next level" }));
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent("Loaded through level 2"),
    );
    await expect(canvasElement.querySelectorAll("g.node")).toHaveLength(4);
    await expect(
      canvas.getByRole("button", { name: "Select GRAPH_A" }).querySelector("circle"),
    ).toHaveAttribute("fill", "#ffffff");
    await expect(
      canvas.getByRole("button", { name: "Select GRAPH_B" }).querySelector("circle"),
    ).not.toHaveAttribute("fill", "#ffffff");
    await expect(canvas.getByRole("button", { name: "Load next level" })).toBeDisabled();
    await userEvent.click(collapse);
    await userEvent.click(canvas.getByRole("button", { name: "Load next level" }));
    await waitFor(() => expect(canvasElement.querySelectorAll("g.node")).toHaveLength(5));
    await expect(canvas.getByRole("status")).toHaveTextContent("Loaded through level 2");
  },
} satisfies Story;

export const ConnectedBranches = {
  beforeEach: () => {
    const mock = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (!url.includes("dbxrefs.json")) return Response.json({ title: "Branch sample" });
      const segments = url.split("/");
      const id = segments[segments.length - 2];
      const refs =
        id === "GRAPH_ROOT"
          ? [ref("BRIDGE"), ref("ALTERNATE", "sra-study")]
          : id === "BRIDGE"
            ? [ref("TAIL", "sra-run"), ref("SHARED", "sra-run")]
            : id === "ALTERNATE"
              ? [ref("SHARED", "sra-run")]
              : id === "TAIL"
                ? [ref("LEAF", "gea")]
                : [];
      return Response.json({ dbXrefs: refs });
    });
    return () => mock.mockRestore();
  },
  play: async ({ canvasElement, canvas }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll("g.node")).toHaveLength(3));
    await userEvent.click(canvas.getByRole("button", { name: "Load next level" }));
    await waitFor(() => expect(canvasElement.querySelectorAll("g.node")).toHaveLength(5));
    await userEvent.click(canvas.getByRole("button", { name: "Load next level" }));
    await waitFor(() => expect(canvasElement.querySelectorAll("g.node")).toHaveLength(6));
    await userEvent.click(canvas.getByRole("button", { name: "Select BRIDGE" }));
    const collapse = canvas.getByRole("checkbox", { name: "Hide connected branch" });
    await userEvent.click(collapse);
    await expect(canvas.getByRole("button", { name: "Select BRIDGE" })).toHaveAttribute(
      "opacity",
      "0.4",
    );
    await expect(canvas.queryByRole("button", { name: "Select TAIL" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Select LEAF" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Select SHARED" })).toBeVisible();
    await expect(canvas.getByRole("status")).toHaveTextContent("4 visible nodes");
    await userEvent.click(collapse);
    await expect(canvas.getByRole("button", { name: "Select LEAF" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Select LEAF" }));
    const legend = within(canvas.getByLabelText("Database legend"));
    await userEvent.click(legend.getByRole("checkbox", { name: "BioSample" }));
    await expect(canvas.queryByRole("button", { name: "Select TAIL" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Select LEAF" })).not.toBeInTheDocument();
    await expect(canvas.queryByLabelText("Selected entry")).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Select SHARED" })).toBeVisible();
    await expect(canvas.getByRole("status")).toHaveTextContent("3 visible nodes");
    await userEvent.click(legend.getByRole("checkbox", { name: "BioSample" }));
    await expect(canvas.getByRole("button", { name: "Select LEAF" })).toBeVisible();
    await expect(canvasElement.querySelectorAll('g.edges line[display="none"]')).toHaveLength(0);
  },
} satisfies Story;

export const ResumeAtLimit = {
  beforeEach: () => {
    let firstRequest = true;
    const mock = spyOn(globalThis, "fetch").mockImplementation(async () => {
      if (firstRequest) {
        firstRequest = false;
        return Response.json({ detail: "Temporarily unavailable" }, { status: 503 });
      }
      return Response.json({ dbXrefs: [ref("GRAPH_A"), ref("GRAPH_B"), ref("GRAPH_C")] });
    });
    return () => mock.mockRestore();
  },
  play: async ({ canvasElement, canvas }) => {
    await expect(await canvas.findByRole("button", { name: "Retry failed entries" })).toBeEnabled();
    const failedCircle = canvas
      .getByRole("button", { name: "Select GRAPH_ROOT" })
      .querySelector("circle");
    await expect(failedCircle).toHaveAttribute("stroke", "#dc2626");
    await expect(failedCircle).not.toHaveAttribute("fill", "#ffffff");
    const limit = canvas.getByRole("spinbutton", { name: "Max nodes" });
    await userEvent.clear(limit);
    await userEvent.type(limit, "2");
    await userEvent.click(canvas.getByRole("button", { name: "Retry failed entries" }));
    await expect(await canvas.findByText(/Node limit reached/)).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Select GRAPH_ROOT" }).querySelector("circle"),
    ).toHaveAttribute("fill", "#ffffff");
    await expect(canvasElement.querySelectorAll("g.node")).toHaveLength(2);
    await userEvent.clear(limit);
    await userEvent.type(limit, "1000");
    await userEvent.click(canvas.getByRole("button", { name: "Continue loading" }));
    await waitFor(() => expect(canvasElement.querySelectorAll("g.node")).toHaveLength(4));
    await expect(canvas.getByRole("status")).toHaveTextContent("Loaded through level 1");
    await userEvent.click(canvas.getByRole("button", { name: "Select GRAPH_ROOT" }));
    await expect(
      within(canvas.getByLabelText("Selected entry")).queryByRole("checkbox", {
        name: "Hide connected branch",
      }),
    ).not.toBeInTheDocument();
  },
} satisfies Story;

export const ThousandNodes = {
  beforeEach: () => {
    const mock = spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ dbXrefs: Array.from({ length: 999 }, (_, index) => ref(`SAMPLE_${index}`)) }),
    );
    // Each request needs an unread Response body.
    mock.mockImplementation(async () =>
      Response.json({ dbXrefs: Array.from({ length: 999 }, (_, index) => ref(`SAMPLE_${index}`)) }),
    );
    return () => mock.mockRestore();
  },
  play: async ({ canvasElement, canvas }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll("g.node")).toHaveLength(1000));
    await userEvent.click(canvas.getByRole("checkbox", { name: "Show IDs" }));
    await waitFor(() =>
      expect(canvasElement.querySelectorAll("g.node text")[999]).toHaveTextContent("SAMPLE_998"),
    );
  },
} satisfies Story;
