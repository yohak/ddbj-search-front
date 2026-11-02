import { drag } from "d3-drag";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom, zoomIdentity } from "d3-zoom";
import { useEffect, useRef } from "react";
import { nodeColor, type GraphNode, type GraphSnapshot } from "./relatedGraph.ts";

type Node = GraphNode & SimulationNodeDatum;
type Edge = SimulationLinkDatum<Node>;
type Props = {
  graph: GraphSnapshot;
  rootKey: string;
  labels: boolean;
  selectedKey?: string;
  onSelect: (node: GraphNode) => void;
  visibleNodeKeys: ReadonlySet<string>;
  collapsedNodeKeys: ReadonlySet<string>;
};
const radius = (node: Node, labels: boolean) =>
  labels ? Math.max(30, node.identifier.length * 3.6 + 10) : node.depth === 0 ? 12 : 7;

export const RelatedGraphSvg = ({
  graph,
  rootKey,
  labels,
  selectedKey,
  onSelect,
  visibleNodeKeys,
  collapsedNodeKeys,
}: Props) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const positions = useRef(new Map<string, Node>());
  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const svg = select(element);
    const viewport = svg
      .selectAll<SVGGElement, unknown>("g.viewport")
      .data([null])
      .join("g")
      .attr("class", "viewport");
    viewport.append("g").attr("class", "edges");
    viewport.append("g").attr("class", "nodes");
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 6])
      .on("zoom", (event) => viewport.attr("transform", event.transform.toString()));
    svg.call(behavior);
    const reset = () => svg.call(behavior.transform, zoomIdentity);
    element.addEventListener("graph-reset", reset);
    return () => {
      svg.on(".zoom", null);
      element.removeEventListener("graph-reset", reset);
    };
  }, []);
  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const svg = select(element);
    const viewport = svg.select<SVGGElement>("g.viewport");
    const nodes: Node[] = graph.nodes.map((node) =>
      Object.assign(positions.current.get(node.key) ?? {}, node),
    );
    nodes.forEach((node) => {
      if (node.key === rootKey) {
        node.fx = 0;
        node.fy = 0;
      } else if (!visibleNodeKeys.has(node.key)) {
        node.fx = null;
        node.fy = null;
        node.vx = 0;
        node.vy = 0;
      }
      positions.current.set(node.key, node);
    });
    const edges: Edge[] = graph.edges.map((edge) => ({
      source: positions.current.get(edge.source)!,
      target: positions.current.get(edge.target)!,
    }));
    const endpoint = (value: Edge["source"]) => value as Node;
    const isVisibleEdge = (edge: Edge) =>
      visibleNodeKeys.has(endpoint(edge.source).key) &&
      visibleNodeKeys.has(endpoint(edge.target).key);
    const simulation = forceSimulation(nodes.filter((node) => visibleNodeKeys.has(node.key)))
      .alphaDecay(0)
      .alpha(0.15)
      .force(
        "link",
        forceLink<Node, Edge>(edges.filter(isVisibleEdge))
          .id((node) => node.key)
          .distance(labels ? 220 : 65)
          .strength(labels ? 0.03 : 0.08),
      )
      .force("charge", forceManyBody<Node>().strength(labels ? -450 : -90))
      .force(
        "collide",
        forceCollide<Node>()
          .radius((node) => radius(node, labels) + (labels ? 10 : 4))
          .iterations(labels ? 3 : 1),
      )
      .force("x", forceX(0).strength(labels ? 0.003 : 0.012))
      .force("y", forceY(0).strength(labels ? 0.003 : 0.012));
    const lines = viewport
      .select("g.edges")
      .selectAll<SVGLineElement, Edge>("line")
      .data(edges)
      .join("line")
      .attr("stroke", "#94a3b8")
      .attr("stroke-opacity", 0.5)
      .attr("stroke-width", 1);
    const groups = viewport
      .select("g.nodes")
      .selectAll<SVGGElement, Node>("g.node")
      .data(nodes, (node) => node.key)
      .join((enter) => {
        const group = enter.append("g").attr("class", "node");
        group.append("circle");
        group.append("text");
        group.append("title");
        return group;
      })
      .attr("role", "button")
      .attr("tabindex", 0)
      .attr("aria-label", (node) => `Select ${node.identifier}`)
      .attr("data-node-key", (node) => node.key)
      .style("cursor", "grab")
      .on("click", (_event, node) => onSelect(node))
      .on("keydown", (event: KeyboardEvent, node) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(node);
        }
      });
    const failed = new Set(graph.failed);
    const loaded = new Set(graph.loaded);
    const isLoaded = (node: Node) => node.link.kind === "external" || loaded.has(node.key);
    groups
      .select("circle")
      .attr("r", (node) => radius(node, labels))
      .attr("fill", (node) =>
        isLoaded(node) || failed.has(node.key) ? nodeColor(node) : "#ffffff",
      )
      .attr("stroke", (node) =>
        failed.has(node.key)
          ? "#dc2626"
          : !isLoaded(node)
            ? nodeColor(node)
            : node.key === selectedKey || node.key === rootKey
              ? "#0f172a"
              : "#ffffff",
      )
      .attr("stroke-width", (node) =>
        node.key === selectedKey || node.key === rootKey || failed.has(node.key) ? 3 : 1.5,
      )
      .attr("stroke-dasharray", (node) => (failed.has(node.key) ? "4 2" : null));
    groups
      .select("text")
      .text((node) => (labels ? node.identifier : ""))
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("fill", (node) =>
        isLoaded(node) || failed.has(node.key) ? "#ffffff" : nodeColor(node),
      )
      .attr("font-size", 12)
      .attr("pointer-events", "none");
    groups
      .select("title")
      .text(
        (node) =>
          `${node.identifier} (${node.type})${failed.has(node.key) ? " — loading failed" : ""}`,
      );
    groups.call(
      drag<SVGGElement, Node>()
        .clickDistance(4)
        .filter((_event, node) => node.key !== rootKey)
        .on("start", (_event, node) => {
          node.fx = node.x;
          node.fy = node.y;
        })
        .on("drag", (event, node) => {
          node.fx = event.x;
          node.fy = event.y;
        })
        .on("end", (_event, node) => {
          node.fx = null;
          node.fy = null;
        }),
    );
    const visibleLines = lines.filter(isVisibleEdge);
    const visibleGroups = groups.filter((node) => visibleNodeKeys.has(node.key));
    simulation.on("tick", () => {
      visibleLines
        .attr("x1", (edge) => endpoint(edge.source).x ?? 0)
        .attr("y1", (edge) => endpoint(edge.source).y ?? 0)
        .attr("x2", (edge) => endpoint(edge.target).x ?? 0)
        .attr("y2", (edge) => endpoint(edge.target).y ?? 0);
      visibleGroups.attr("transform", (node) => `translate(${node.x ?? 0},${node.y ?? 0})`);
    });
    if (visibleNodeKeys.size === 0) simulation.stop();
    return () => {
      simulation.stop();
      groups.on(".drag", null);
    };
  }, [graph, rootKey, labels, selectedKey, onSelect, visibleNodeKeys]);
  // Hidden nodes retain their coordinates in the cache, outside the active simulation.
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = select(svgRef.current);
    svg
      .selectAll<SVGGElement, Node>("g.node")
      .attr("display", (node) => (visibleNodeKeys.has(node.key) ? null : "none"))
      .attr("opacity", (node) => (collapsedNodeKeys.has(node.key) ? 0.4 : 1));
    svg
      .selectAll<SVGLineElement, Edge>("g.edges line")
      .attr("display", (edge) =>
        !visibleNodeKeys.has((edge.source as Node).key) ||
        !visibleNodeKeys.has((edge.target as Node).key)
          ? "none"
          : null,
      );
  }, [graph, visibleNodeKeys, collapsedNodeKeys]);
  return (
    <div className="relative h-[600px] overflow-hidden rounded border border-gray-200 bg-slate-50">
      <svg
        ref={svgRef}
        viewBox="-450 -300 900 600"
        className="h-full w-full touch-none"
        aria-label="Related entries graph"
        role="group"
      />
      <button
        type="button"
        className="absolute right-3 bottom-3 rounded border border-gray-300 bg-white px-3 py-1 text-sm"
        onClick={() => svgRef.current?.dispatchEvent(new Event("graph-reset"))}
      >
        Reset view
      </button>
      <p className="pointer-events-none absolute top-3 left-3 text-xs text-slate-500">
        Drag nodes · Scroll to zoom · Drag background to pan
      </p>
    </div>
  );
};
