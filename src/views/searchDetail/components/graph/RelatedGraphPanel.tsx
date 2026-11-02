import { Checkbox } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { z } from "zod";
import { dbLabels, getXrefDbLabel } from "@/consts/db.ts";
import { getEntryTitle } from "@/lib/entry/getEntryTitle.ts";
import { reorderXrefs } from "@/lib/entry/reorderXrefs.ts";
import { parseJsonResponse } from "@/lib/fetch/http/httpError.ts";
import { API_PATH_ALL_ENTRIES_LIST } from "@/schema/api/paths.ts";
import type { SearchDetailResponse } from "@/schema/api/types.ts";
import { DbLink } from "@/views/searchDetail/components/ui/DbLink.tsx";
import { PanelWrapper } from "@/views/searchDetail/components/ui/PanelWrapper.tsx";
import {
  RelatedGraph,
  getVisibleNodeKeys,
  nodeColor,
  nodeLabel,
  type GraphNode,
} from "./relatedGraph.ts";
import { RelatedGraphSvg } from "./RelatedGraphSvg.tsx";

type Props = { data: SearchDetailResponse };
const INITIAL_NODE_LIMIT = 1000;
const LEGEND_ORDER = [...Object.values(dbLabels), "External links"];
const summarySchema = z.object({ title: z.string().nullish(), name: z.string().nullish() });

export const RelatedGraphPanel = ({ data }: Props) => {
  const [session] = useState(() => new RelatedGraph(data.type, data.identifier));
  const [graph, setGraph] = useState(() => session.snapshot());
  const [limit, setLimit] = useState(String(INITIAL_NODE_LIMIT));
  const [labels, setLabels] = useState(false);
  const [hiddenDatabases, setHiddenDatabases] = useState<ReadonlySet<string>>(() => new Set());
  const [collapsedNodeKeys, setCollapsedNodeKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [selection, setSelected] = useState<GraphNode | null>(null);
  const visibleNodeKeys = useMemo(
    () => getVisibleNodeKeys(graph, session.root.key, hiddenDatabases, collapsedNodeKeys),
    [graph, session, hiddenDatabases, collapsedNodeKeys],
  );
  const selected = selection && visibleNodeKeys.has(selection.key) ? selection : null;
  const expandableNodeKeys = useMemo(
    () => new Set([...visibleNodeKeys].filter((key) => !collapsedNodeKeys.has(key))),
    [visibleNodeKeys, collapsedNodeKeys],
  );
  const hasExpandableNodes = useMemo(() => {
    const loaded = new Set(graph.loaded);
    return graph.nodes.some(
      (node) =>
        node.link.kind === "internal" && expandableNodeKeys.has(node.key) && !loaded.has(node.key),
    );
  }, [graph, expandableNodeKeys]);
  const [loading, setLoading] = useState(true);
  const [loadingNodeKey, setLoadingNodeKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const maximum = Number(limit);
  const validLimit = Number.isSafeInteger(maximum) && maximum >= graph.nodes.length;
  const load = useCallback(
    async (
      nodeLimit: number,
      retry = false,
      nodeKey?: string,
      eligibleNodeKeys?: ReadonlySet<string>,
    ) => {
      if (
        controller.current ||
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit < session.snapshot().nodes.length
      )
        return;
      const abort = new AbortController();
      controller.current = abort;
      setLoading(true);
      setLoadingNodeKey(nodeKey ?? null);
      setError(null);
      try {
        if (nodeKey) await session.expandNode(nodeKey, nodeLimit, abort.signal, setGraph);
        else await session.expand(nodeLimit, abort.signal, setGraph, retry, eligibleNodeKeys);
      } catch (cause) {
        if (!abort.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Loading failed.");
      } finally {
        if (controller.current === abort) controller.current = null;
        if (!abort.signal.aborted) {
          setLoading(false);
          setLoadingNodeKey(null);
        }
      }
    },
    [session],
  );
  useEffect(() => {
    void load(INITIAL_NODE_LIMIT);
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, [load]);
  const summary = useQuery({
    queryKey: ["related-graph-summary", selected?.type, selected?.identifier],
    enabled:
      selected !== null && selected.link.kind === "internal" && selected.key !== session.root.key,
    queryFn: async ({ signal }) => {
      if (!selected) return null;
      const response = await fetch(
        `${API_PATH_ALL_ENTRIES_LIST}${selected.type}/${encodeURIComponent(selected.identifier)}?dbXrefsLimit=0`,
        { signal },
      );
      return summarySchema.parse(await parseJsonResponse<unknown>(response));
    },
    staleTime: 300_000,
    retry: false,
  });
  const title =
    selected?.key === session.root.key
      ? getEntryTitle(data)
      : summary.data?.title || summary.data?.name;
  const legend = [...new Map(graph.nodes.map((node) => [nodeLabel(node), node])).values()].sort(
    (a, b) => LEGEND_ORDER.indexOf(nodeLabel(a)) - LEGEND_ORDER.indexOf(nodeLabel(b)),
  );
  const visibleNodeCount = visibleNodeKeys.size;
  const relatedCounts = selected ? session.getRelatedCounts(selected.key) : null;
  const relatedTotal = relatedCounts
    ? Object.values(relatedCounts).reduce((sum, count) => sum + count, 0)
    : 0;
  return (
    <PanelWrapper className="gap-3 py-4">
      <h2 className="text-sm font-bold">
        Related Entries Graph <span className="font-normal text-gray-500">(Prototype)</span>
      </h2>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          className="rounded bg-blue-700 px-3 py-2 text-white disabled:opacity-50"
          disabled={
            loading ||
            !validLimit ||
            graph.exhausted ||
            !hasExpandableNodes ||
            (graph.capped && maximum <= graph.nodes.length)
          }
          onClick={() => void load(maximum, false, undefined, expandableNodeKeys)}
        >
          {loading ? "Loading…" : graph.capped ? "Continue loading" : "Load next level"}
        </button>
        <label className="flex items-center gap-2">
          Max nodes
          <input
            aria-label="Max nodes"
            type="number"
            min={graph.nodes.length}
            step={1}
            value={limit}
            className="w-24 rounded border border-gray-300 px-2 py-1"
            onChange={(event) => setLimit(event.target.value)}
          />
        </label>
        <Checkbox className="flex items-center gap-2.5" isSelected={labels} onChange={setLabels}>
          <Checkbox.Control className="border-border before:bg-bg-primary size-5 shrink-0 rounded-sm border shadow-none before:rounded-none">
            <Checkbox.Indicator className="text-white" />
          </Checkbox.Control>
          <Checkbox.Content className="text-sm text-gray-900">Show IDs</Checkbox.Content>
        </Checkbox>
        {loading && (
          <button
            type="button"
            className="rounded border border-gray-300 px-3 py-1"
            onClick={() => {
              controller.current?.abort();
              controller.current = null;
              setLoading(false);
              setLoadingNodeKey(null);
              setGraph(session.snapshot());
            }}
          >
            Cancel loading
          </button>
        )}
      </div>
      <p className="text-xs text-gray-600" role="status" aria-live="polite">
        {graph.nodes.length.toLocaleString()} nodes · {graph.edges.length.toLocaleString()} links ·
        Loaded through level {graph.depth}
        {hiddenDatabases.size > 0 || collapsedNodeKeys.size > 0
          ? ` · ${visibleNodeCount.toLocaleString()} visible nodes`
          : ""}
        {loading ? " · Loading next connections…" : ""}
        {graph.exhausted ? " · All reachable connections loaded" : ""}
      </p>
      {!validLimit && (
        <p role="alert" className="text-sm text-red-700">
          Enter a whole number of at least {graph.nodes.length}.
        </p>
      )}
      {graph.capped && (
        <p className="text-sm text-amber-800">
          Node limit reached. Increase Max nodes to continue this level.
        </p>
      )}
      {graph.failed.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-red-700">
          <span>
            {graph.failed.length} entries could not be loaded. Marked with a red dashed border.
          </span>
          <button
            type="button"
            className="rounded border border-red-300 px-2 py-1"
            disabled={loading || !validLimit}
            onClick={() => void load(maximum, true, undefined, expandableNodeKeys)}
          >
            Retry failed entries
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <RelatedGraphSvg
            graph={graph}
            rootKey={session.root.key}
            labels={labels}
            selectedKey={selected?.key}
            onSelect={setSelected}
            visibleNodeKeys={visibleNodeKeys}
            collapsedNodeKeys={collapsedNodeKeys}
          />
        </div>
        <div
          className="flex max-h-[600px] w-40 shrink-0 flex-col gap-2 overflow-y-auto py-2 text-xs"
          aria-label="Database legend"
        >
          {legend.map((node) => (
            <Checkbox
              key={nodeLabel(node)}
              className="flex items-center gap-2.5"
              style={
                { "--accent": nodeColor(node), "--accent-hover": nodeColor(node) } as CSSProperties
              }
              isSelected={!hiddenDatabases.has(nodeLabel(node))}
              onChange={(visible) => {
                const database = nodeLabel(node);
                setHiddenDatabases((current) => {
                  const next = new Set(current);
                  if (visible) next.delete(database);
                  else next.add(database);
                  return next;
                });
              }}
            >
              <Checkbox.Control className="border-border size-5 shrink-0 rounded-sm border shadow-none before:rounded-none">
                <Checkbox.Indicator className="text-white" />
              </Checkbox.Control>
              <Checkbox.Content className="text-sm leading-5 whitespace-nowrap text-gray-900">
                {nodeLabel(node)}
              </Checkbox.Content>
            </Checkbox>
          ))}
        </div>
      </div>
      {selected ? (
        <div
          className="rounded border border-gray-200 bg-gray-50 p-3 text-sm"
          aria-label="Selected entry"
        >
          <div className="flex items-start justify-between gap-3">
            <strong className="break-all">{selected.identifier}</strong>
            <button
              type="button"
              aria-label="Close entry summary"
              onClick={() => setSelected(null)}
            >
              Close
            </button>
          </div>
          <p>
            {getXrefDbLabel(selected.type)} · Level {selected.depth}
            {selected.link.kind === "external" ? " · External link (not explored)" : ""}
          </p>
          {title && <p className="mt-1">{title}</p>}
          {summary.isFetching && <p>Loading title…</p>}
          {summary.isError && (
            <p className="text-red-700">
              Title could not be loaded.{" "}
              <button type="button" onClick={() => void summary.refetch()}>
                Retry
              </button>
            </p>
          )}
          {relatedCounts && (
            <div className="mt-3" aria-label="Related entry counts">
              <h3 className="font-medium">Related entries ({relatedTotal.toLocaleString()})</h3>
              {relatedTotal === 0 ? (
                <p className="text-gray-500">No related entries.</p>
              ) : (
                <table className="mt-1 text-sm" aria-label="Related entries by database">
                  <thead className="sr-only">
                    <tr>
                      <th scope="col">Database</th>
                      <th scope="col">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reorderXrefs(relatedCounts).map(([type, count]) => (
                      <tr key={type}>
                        <th scope="row" className="pr-6 text-left font-normal">
                          {getXrefDbLabel(type)}
                        </th>
                        <td className="text-right tabular-nums">{count.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          {selected.link.kind === "internal" && (
            <div className="mt-3 flex flex-col items-start gap-2">
              <button
                type="button"
                className="text-link-primary underline underline-offset-2 disabled:cursor-default disabled:text-gray-500 disabled:no-underline"
                disabled={
                  loading ||
                  !validLimit ||
                  graph.loaded.includes(selected.key) ||
                  (graph.capped && maximum <= graph.nodes.length)
                }
                onClick={() => void load(maximum, false, selected.key)}
              >
                {loadingNodeKey === selected.key
                  ? "Loading related entries…"
                  : graph.loaded.includes(selected.key)
                    ? "Related entries loaded"
                    : graph.failed.includes(selected.key)
                      ? "Retry loading related entries"
                      : "Load related entries"}
              </button>
              {selected.depth > 0 && (
                <Checkbox
                  className="flex items-center gap-2.5"
                  isSelected={collapsedNodeKeys.has(selected.key)}
                  onChange={(collapsed) => {
                    setCollapsedNodeKeys((current) => {
                      const next = new Set(current);
                      if (collapsed) next.add(selected.key);
                      else next.delete(selected.key);
                      return next;
                    });
                  }}
                >
                  <Checkbox.Control className="border-border before:bg-bg-primary size-5 shrink-0 rounded-sm border shadow-none before:rounded-none">
                    <Checkbox.Indicator className="text-white" />
                  </Checkbox.Control>
                  <Checkbox.Content className="text-sm text-gray-900">
                    Hide connected branch
                  </Checkbox.Content>
                </Checkbox>
              )}
            </div>
          )}
          <DbLink link={selected.link} className="text-link-primary mt-2 inline-block">
            Open entry
          </DbLink>
        </div>
      ) : (
        <p className="text-xs text-gray-500">Select a node to view its ID, database and title.</p>
      )}
    </PanelWrapper>
  );
};
