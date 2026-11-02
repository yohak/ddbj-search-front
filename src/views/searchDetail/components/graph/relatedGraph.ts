import { z } from "zod";
import { dbTypeList, getXrefDbLabel } from "@/consts/db.ts";
import { parseJsonResponse } from "@/lib/fetch/http/httpError.ts";
import { resolveDbLink, type ResolvedDbLink } from "@/lib/sanitizing/sanitizeDbLink.ts";
import { XrefSchema, type Xref } from "@/schema/api/detail/base.ts";
import { getDBXrefAPIPath } from "@/schema/api/paths.ts";

export type GraphNode = {
  key: string;
  identifier: string;
  type: string;
  depth: number;
  link: ResolvedDbLink;
};
export type GraphEdge = { key: string; source: string; target: string };
export type GraphSnapshot = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  depth: number;
  capped: boolean;
  failed: string[];
  loaded: string[];
  exhausted: boolean;
};

type LoadRefs = (node: GraphNode, signal: AbortSignal) => Promise<Xref[]>;
const colors = [
  "#2563eb",
  "#059669",
  "#d97706",
  "#9333ea",
  "#0891b2",
  "#db2777",
  "#4f46e5",
  "#b45309",
  "#be123c",
  "#0f766e",
  "#7e22ce",
  "#475569",
  "#65a30d",
  "#c2410c",
];
export const nodeColor = (node: GraphNode) =>
  node.link.kind === "external"
    ? "#64748b"
    : (colors[dbTypeList.indexOf(node.type as (typeof dbTypeList)[number])] ?? "#64748b");
export const nodeLabel = (node: GraphNode) =>
  node.link.kind === "external" ? "External links" : getXrefDbLabel(node.type);

export const getVisibleNodeKeys = (
  graph: GraphSnapshot,
  rootKey: string,
  hiddenDatabases: ReadonlySet<string>,
  collapsedNodeKeys: ReadonlySet<string> = new Set(),
): ReadonlySet<string> => {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (!hiddenDatabases.has(nodeLabel(node))) adjacency.set(node.key, []);
  }
  const visible = new Set<string>();
  if (!adjacency.has(rootKey)) return visible;
  for (const edge of graph.edges) {
    const source = adjacency.get(edge.source);
    const target = adjacency.get(edge.target);
    if (source && target) {
      source.push(edge.target);
      target.push(edge.source);
    }
  }
  const queue = [rootKey];
  visible.add(rootKey);
  for (let index = 0; index < queue.length; index++) {
    if (collapsedNodeKeys.has(queue[index]!)) continue;
    for (const neighbor of adjacency.get(queue[index]!) ?? []) {
      if (visible.has(neighbor)) continue;
      visible.add(neighbor);
      queue.push(neighbor);
    }
  }
  return visible;
};

const toNode = (ref: Xref, depth: number): GraphNode | null => {
  const link = resolveDbLink(ref.url);
  if (link.kind === "internal") {
    const [, , type, encodedIdentifier] = link.to.split("/");
    if (!type || !encodedIdentifier) return null;
    const identifier = decodeURIComponent(encodedIdentifier);
    return { key: JSON.stringify([type, identifier]), identifier, type, depth, link };
  }
  try {
    const url = new URL(link.href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return {
      key: `external:${url.href}`,
      identifier: ref.identifier,
      type: ref.type,
      depth,
      link: { kind: "external", href: url.href },
    };
  } catch {
    return null;
  }
};

const refsSchema = z.object({ dbXrefs: z.array(XrefSchema).nullable() });
const loadRefs: LoadRefs = async (node, signal) => {
  const response = await fetch(getDBXrefAPIPath(node.type, encodeURIComponent(node.identifier)), {
    signal,
  });
  return refsSchema.parse(await parseJsonResponse<unknown>(response)).dbXrefs ?? [];
};

// Retain reference cursors so raising the cap never skips the remainder of a node.
export class RelatedGraph {
  readonly root: GraphNode;
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();
  private refs = new Map<string, Xref[]>();
  private cursors = new Map<string, number>();
  private expanded = new Set<string>();
  private failed = new Set<string>();
  private depth = 0;
  private pendingDepth: number | null = null;
  private cappedNodes = new Set<string>();
  private fetchRefs: LoadRefs;
  constructor(type: string, identifier: string, fetchRefs: LoadRefs = loadRefs) {
    this.fetchRefs = fetchRefs;
    this.root = {
      key: JSON.stringify([type, identifier]),
      type,
      identifier,
      depth: 0,
      link: { kind: "internal", to: `/entry/${type}/${encodeURIComponent(identifier)}/` },
    };
    this.nodes.set(this.root.key, this.root);
  }
  snapshot(): GraphSnapshot {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
      depth: this.depth,
      capped: this.cappedNodes.size > 0,
      failed: [...this.failed],
      loaded: [...this.expanded],
      exhausted: [...this.nodes.values()].every(
        (node) => node.link.kind === "external" || this.expanded.has(node.key),
      ),
    };
  }
  getRelatedCounts(key: string): Record<string, number> | null {
    if (!this.expanded.has(key)) return null;
    const counts: Record<string, number> = {};
    for (const ref of this.refs.get(key) ?? []) {
      counts[ref.type] = (counts[ref.type] ?? 0) + 1;
    }
    return counts;
  }
  async expand(
    limit: number,
    signal: AbortSignal,
    onProgress: (snapshot: GraphSnapshot) => void,
    retry = false,
    eligibleNodeKeys?: ReadonlySet<string>,
  ) {
    const eligibleNodes = [...this.nodes.values()].filter(
      (node) =>
        node.link.kind === "internal" &&
        !this.expanded.has(node.key) &&
        (!eligibleNodeKeys || eligibleNodeKeys.has(node.key)),
    );
    if (eligibleNodes.length === 0) {
      onProgress(this.snapshot());
      return;
    }
    const nextDepth = eligibleNodes.reduce(
      (depth, node) => Math.min(depth, node.depth + 1),
      Infinity,
    );
    const pendingDepth = this.pendingDepth;
    const targetDepth =
      pendingDepth !== null &&
      eligibleNodes.some((node) => node.depth < pendingDepth || this.cappedNodes.has(node.key))
        ? pendingDepth
        : retry
          ? Math.max(1, this.depth)
          : nextDepth;
    this.pendingDepth = targetDepth;
    const frontier = eligibleNodes.filter(
      (node) =>
        node.depth < targetDepth ||
        this.cappedNodes.has(node.key) ||
        (retry && this.failed.has(node.key)),
    );
    await this.loadNodes(frontier, limit, signal, onProgress);
    if (![...this.cappedNodes].some((key) => !eligibleNodeKeys || eligibleNodeKeys.has(key))) {
      this.depth = Math.max(this.depth, targetDepth);
      this.pendingDepth = null;
    }
    onProgress(this.snapshot());
  }
  async expandNode(
    key: string,
    limit: number,
    signal: AbortSignal,
    onProgress: (snapshot: GraphSnapshot) => void,
  ) {
    const node = this.nodes.get(key);
    if (!node || node.link.kind === "external" || this.expanded.has(key)) return;
    await this.loadNodes([node], limit, signal, onProgress);
    onProgress(this.snapshot());
  }
  private async loadNodes(
    frontier: GraphNode[],
    limit: number,
    signal: AbortSignal,
    onProgress: (snapshot: GraphSnapshot) => void,
  ) {
    let capped = false;
    for (let offset = 0; offset < frontier.length; offset += 4) {
      let shorterPath = false;
      signal.throwIfAborted();
      const batch = frontier.slice(offset, offset + 4);
      const results = await Promise.allSettled(
        batch.map(async (node) => {
          if (this.refs.has(node.key)) return this.refs.get(node.key)!;
          return this.fetchRefs(node, signal);
        }),
      );
      signal.throwIfAborted();
      for (const [index, node] of batch.entries()) {
        const result = results[index]!;
        if (result.status === "rejected") {
          this.failed.add(node.key);
          continue;
        }
        this.failed.delete(node.key);
        this.refs.set(node.key, result.value);
        let cursor = this.cursors.get(node.key) ?? 0;
        for (; cursor < result.value.length; cursor++) {
          const related = toNode(result.value[cursor]!, node.depth + 1);
          if (!related || related.key === node.key) continue;
          if (!this.nodes.has(related.key)) {
            if (this.nodes.size >= limit) {
              this.cappedNodes.add(node.key);
              capped = true;
              break;
            }
            this.nodes.set(related.key, related);
          }
          const key = JSON.stringify([node.key, related.key].sort());
          this.edges.set(key, { key, source: node.key, target: related.key });
          if (Math.abs(this.nodes.get(related.key)!.depth - node.depth) > 1) shorterPath = true;
        }
        this.cursors.set(node.key, cursor);
        if (cursor === result.value.length) {
          this.expanded.add(node.key);
          this.cappedNodes.delete(node.key);
        }
      }
      if (shorterPath) this.updateDepths();
      onProgress(this.snapshot());
      if (capped) break;
    }
  }
  private updateDepths() {
    const neighbors = new Map<string, string[]>();
    for (const node of this.nodes.values()) neighbors.set(node.key, []);
    for (const edge of this.edges.values()) {
      neighbors.get(edge.source)!.push(edge.target);
      neighbors.get(edge.target)!.push(edge.source);
    }
    const queue = [this.root.key];
    const visited = new Set(queue);
    for (let index = 0; index < queue.length; index++) {
      const node = this.nodes.get(queue[index]!)!;
      for (const key of neighbors.get(node.key)!) {
        if (visited.has(key)) continue;
        visited.add(key);
        this.nodes.get(key)!.depth = node.depth + 1;
        queue.push(key);
      }
    }
  }
}
