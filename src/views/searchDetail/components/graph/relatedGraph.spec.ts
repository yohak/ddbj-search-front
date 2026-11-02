import { describe, expect, it, vi } from "vitest";
import type { Xref } from "@/schema/api/detail/base.ts";
import { RelatedGraph, getVisibleNodeKeys, type GraphSnapshot } from "./relatedGraph.ts";

const ref = (identifier: string, type = "biosample"): Xref => ({
  identifier,
  type,
  url: `https://ddbj.nig.ac.jp/search/entry/${type}/${identifier}`,
});
const signal = () => new AbortController().signal;
const progress = () => {};

describe("RelatedGraph visibility", () => {
  const graph: GraphSnapshot = {
    nodes: [
      ["root", "bioproject"],
      ["bridge", "biosample"],
      ["tail", "sra-run"],
      ["leaf", "gea"],
      ["shared", "sra-run"],
      ["alternate", "sra-study"],
    ].map(([key, type]) => ({
      key: key!,
      identifier: key!,
      type: type!,
      depth: 0,
      link: { kind: "internal", to: `/entry/${type}/${key}/` },
    })),
    edges: [
      ["root", "bridge"],
      ["bridge", "tail"],
      ["tail", "leaf"],
      ["bridge", "shared"],
      ["shared", "alternate"],
      ["alternate", "root"],
    ].map(([source, target]) => ({ key: `${source}/${target}`, source: source!, target: target! })),
    depth: 3,
    capped: false,
    failed: [],
    loaded: [],
    exhausted: true,
  };
  it("hides the entire disconnected branch while preserving an alternative undirected path", () => {
    expect([...getVisibleNodeKeys(graph, "root", new Set(["BioSample"]))].sort()).toEqual([
      "alternate",
      "root",
      "shared",
    ]);
    expect(graph.nodes).toHaveLength(6);
    expect(graph.edges).toHaveLength(6);
  });
  it("restores the full graph when the database is enabled again", () => {
    expect(getVisibleNodeKeys(graph, "root", new Set()).size).toBe(6);
  });
  it("hides all nodes when the root database is hidden", () => {
    expect(getVisibleNodeKeys(graph, "root", new Set(["BioProject"])).size).toBe(0);
  });
  it("keeps the collapsed node and alternative paths while hiding the branch beyond it", () => {
    expect([...getVisibleNodeKeys(graph, "root", new Set(), new Set(["bridge"]))].sort()).toEqual([
      "alternate",
      "bridge",
      "root",
      "shared",
    ]);
    expect(getVisibleNodeKeys(graph, "root", new Set(), new Set()).size).toBe(6);
  });
  it("keeps only the root when the root is collapsed", () => {
    expect([...getVisibleNodeKeys(graph, "root", new Set(), new Set(["root"]))]).toEqual(["root"]);
  });
});

describe("RelatedGraph exploration", () => {
  it("starts at level zero, expands breadth-first, deduplicates cycles and retains shared edges", async () => {
    const fetcher = vi.fn(
      async (node: { identifier: string }) =>
        ({
          root: [ref("A"), ref("B")],
          A: [ref("root", "bioproject"), ref("B"), ref("C")],
          B: [ref("A"), ref("C")],
          C: [],
        })[node.identifier] ?? [],
    );
    const graph = new RelatedGraph("bioproject", "root", fetcher);
    expect(graph.snapshot().nodes).toHaveLength(1);
    expect(fetcher).not.toHaveBeenCalled();
    await graph.expand(1000, signal(), progress);
    expect(graph.snapshot().nodes.map((node) => node.identifier)).toEqual(["root", "A", "B"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await graph.expand(1000, signal(), progress);
    expect(graph.snapshot().nodes.map((node) => node.identifier)).toEqual(["root", "A", "B", "C"]);
    expect(graph.snapshot().edges).toHaveLength(5);
    expect(graph.snapshot().depth).toBe(2);
  });
  it("resumes an unfinished reference list when the node limit is increased", async () => {
    const fetcher = vi.fn(async () => [ref("A"), ref("B"), ref("C")]);
    const graph = new RelatedGraph("bioproject", "root", fetcher);
    await graph.expand(2, signal(), progress);
    expect(graph.snapshot()).toMatchObject({ capped: true, depth: 0 });
    expect(graph.snapshot().nodes).toHaveLength(2);
    expect(graph.getRelatedCounts(graph.root.key)).toBeNull();
    await graph.expand(4, signal(), progress);
    expect(graph.snapshot()).toMatchObject({ capped: false, depth: 1 });
    expect(graph.snapshot().nodes).toHaveLength(4);
    expect(graph.snapshot().edges).toHaveLength(3);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(graph.getRelatedCounts(graph.root.key)).toEqual({ biosample: 3 });
  });
  it("keeps successful branches, retries failures and never expands external links", async () => {
    let fail = true;
    const fetcher = vi.fn(async (node: { identifier: string }) => {
      if (node.identifier === "root")
        return [
          ref("A"),
          ref("B"),
          { identifier: "external", type: "other", url: "https://example.com/external" },
          { identifier: "unsafe", type: "other", url: "javascript:alert(1)" },
        ];
      if (node.identifier === "A" && fail) throw new Error("Unavailable");
      return node.identifier === "A" ? [ref("C")] : [];
    });
    const graph = new RelatedGraph("bioproject", "root", fetcher);
    await graph.expand(1000, signal(), progress);
    await graph.expand(1000, signal(), progress);
    expect(graph.snapshot().failed).toHaveLength(1);
    expect(graph.snapshot().nodes).toHaveLength(4);
    fail = false;
    await graph.expand(1000, signal(), progress, true);
    expect(graph.snapshot().failed).toHaveLength(0);
    expect(graph.snapshot().nodes).toHaveLength(5);
    expect(fetcher.mock.calls.some(([node]) => node.identifier === "external")).toBe(false);
  });
  it("does not commit a response received after cancellation", async () => {
    const controller = new AbortController();
    const graph = new RelatedGraph("bioproject", "root", async () => {
      controller.abort();
      return [ref("A")];
    });
    await expect(graph.expand(1000, controller.signal, progress)).rejects.toThrow();
    expect(graph.snapshot().nodes).toHaveLength(1);
    expect(graph.snapshot().failed).toHaveLength(0);
  });
  it("expands only the selected branch, skips loaded nodes and corrects shorter paths", async () => {
    const fetcher = vi.fn(
      async (node: { identifier: string }) =>
        ({
          root: [ref("A"), ref("B")],
          A: [ref("C")],
          C: [ref("D")],
          B: [ref("D")],
          D: [],
        })[node.identifier] ?? [],
    );
    const graph = new RelatedGraph("bioproject", "root", fetcher);
    await graph.expand(1000, signal(), progress);
    const key = (id: string) => graph.snapshot().nodes.find((node) => node.identifier === id)!.key;
    await graph.expandNode(key("A"), 1000, signal(), progress);
    expect(fetcher.mock.calls.map(([node]) => node.identifier)).toEqual(["root", "A"]);
    expect(graph.snapshot().depth).toBe(1);
    await graph.expandNode(key("C"), 1000, signal(), progress);
    expect(graph.snapshot().nodes.find((node) => node.identifier === "D")?.depth).toBe(3);
    await graph.expandNode(key("B"), 1000, signal(), progress);
    expect(graph.snapshot().nodes.find((node) => node.identifier === "D")?.depth).toBe(2);
    await graph.expandNode(key("A"), 1000, signal(), progress);
    expect(fetcher).toHaveBeenCalledTimes(4);
    await graph.expand(1000, signal(), progress);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(graph.snapshot().depth).toBe(3);
  });
  it("resumes a capped individual load without fetching it again", async () => {
    const fetcher = vi.fn(async (node: { identifier: string }) =>
      node.identifier === "root" ? [ref("A")] : [ref("B"), ref("C")],
    );
    const graph = new RelatedGraph("bioproject", "root", fetcher);
    await graph.expand(1000, signal(), progress);
    const selected = graph.snapshot().nodes.find((node) => node.identifier === "A")!;
    await graph.expandNode(selected.key, 3, signal(), progress);
    expect(graph.snapshot().capped).toBe(true);
    expect(graph.snapshot().loaded).not.toContain(selected.key);
    await graph.expandNode(selected.key, 4, signal(), progress);
    expect(graph.snapshot().capped).toBe(false);
    expect(graph.snapshot().loaded).toContain(selected.key);
    expect(graph.snapshot().nodes).toHaveLength(4);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("skips hidden nodes, then catches up their level when shown again", async () => {
    const fetcher = vi.fn(
      async (node: { identifier: string }) =>
        ({
          root: [ref("A"), ref("B", "sra-study")],
          A: [ref("C")],
          B: [ref("D", "sra-run")],
          D: [],
        })[node.identifier] ?? [],
    );
    const graph = new RelatedGraph("bioproject", "root", fetcher);
    await graph.expand(1000, signal(), progress);
    const visible = getVisibleNodeKeys(graph.snapshot(), graph.root.key, new Set(["BioSample"]));
    await graph.expand(1000, signal(), progress, false, visible);
    expect(fetcher.mock.calls.map(([node]) => node.identifier)).toEqual(["root", "B"]);
    expect(graph.snapshot().nodes.map((node) => node.identifier)).toEqual(["root", "A", "B", "D"]);
    const shown = getVisibleNodeKeys(graph.snapshot(), graph.root.key, new Set());
    await graph.expand(1000, signal(), progress, false, shown);
    expect(fetcher.mock.calls.map(([node]) => node.identifier)).toEqual(["root", "B", "A"]);
    expect(graph.snapshot().depth).toBe(2);
    await graph.expand(1000, signal(), progress, false, new Set());
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(graph.snapshot().depth).toBe(2);
  });
  it("retries a failed individual load and treats external nodes as terminal", async () => {
    let fail = true;
    const fetcher = vi.fn(async (node: { identifier: string }) => {
      if (node.identifier === "root")
        return [
          ref("A"),
          { identifier: "external", type: "other", url: "https://example.com/terminal" },
        ];
      if (fail) throw new Error("Unavailable");
      return [];
    });
    const graph = new RelatedGraph("bioproject", "root", fetcher);
    await graph.expand(1000, signal(), progress);
    const node = graph.snapshot().nodes.find((node) => node.identifier === "A")!;
    await graph.expandNode(node.key, 1000, signal(), progress);
    expect(graph.snapshot().failed).toContain(node.key);
    fail = false;
    await graph.expandNode(node.key, 1000, signal(), progress);
    expect(graph.snapshot().failed).not.toContain(node.key);
    expect(graph.snapshot().loaded).toContain(node.key);
    const external = graph.snapshot().nodes.find((node) => node.identifier === "external")!;
    await graph.expandNode(external.key, 1000, signal(), progress);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
