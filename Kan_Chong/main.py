"""
Kan Chiong Delivery Driver — time-dependent fastest-route service.

POST /kan-cheong-delivery-driver
Body: { case_id: { start_coordinate, end_coordinate, start_time, nodes, edges, obstructions }, ... }
Returns: { case_id: { total_duration_sec, arrival_time, path }, ... }
"""

import heapq
import bisect
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI()

_EPS = 1e-9


# ---------------------------------------------------------------------------
# Time helpers
# ---------------------------------------------------------------------------

def parse_iso(ts: str) -> float:
    """Parse an ISO-8601 UTC timestamp (accepts trailing 'Z') to epoch seconds."""
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"
    return datetime.fromisoformat(ts).timestamp()


def epoch_to_iso(epoch: float) -> str:
    dt = datetime.fromtimestamp(epoch, tz=timezone.utc)
    # Round to whole seconds (durations in the problem are integer seconds and
    # obstruction math only ever adds whole/rational seconds derived from them).
    dt = dt.replace(microsecond=0) + timedelta(seconds=round(dt.microsecond / 1_000_000))
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Piecewise edge traversal under time-varying obstructions
# ---------------------------------------------------------------------------

def traverse_edge(entry_time: float, base_duration: float, obstructions: list) -> Optional[float]:
    """
    obstructions: list of (start_epoch, end_epoch, speed_factor) sorted by start_epoch,
    for this specific directed edge.

    Returns the exit (arrival) epoch time, or None if traversal is blocked
    (i.e. the trip would require passing through a speed_factor == 0.0 window,
    which is impossible since waiting is not allowed).
    """
    if base_duration <= 0:
        return entry_time

    remaining = float(base_duration)
    t = entry_time
    starts = [o[0] for o in obstructions]
    n = len(obstructions)

    while remaining > _EPS:
        # Find obstructions active at time t (their window covers t); if several
        # overlap, take the most restrictive (lowest) speed factor and the
        # earliest end among the active ones to keep the timeline correct.
        active_factor = 1.0
        active_end = None
        for (s, e, f) in obstructions:
            if s <= t < e:
                if active_end is None or f < active_factor:
                    active_factor = f
                    active_end = e
                elif active_end is not None and e < active_end and f <= active_factor:
                    active_end = e

        if active_end is not None:
            segment_end = active_end
            factor = active_factor
        else:
            # No obstruction active right now; free-flow until the next one starts.
            idx = bisect.bisect_right(starts, t)
            segment_end = obstructions[idx][0] if idx < n else None
            factor = 1.0

        if factor <= 0.0:
            # Stuck: cannot wait, cannot proceed.
            return None

        segment_length = None if segment_end is None else (segment_end - t)

        time_needed = remaining / factor

        if segment_length is None or time_needed <= segment_length + _EPS:
            t = t + time_needed
            remaining = 0.0
        else:
            remaining -= segment_length * factor
            t = segment_end

    return t


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------

def build_graph(nodes, edges, obstructions):
    adj = {}
    for n in nodes:
        adj.setdefault(tuple(n), [])

    edge_base = {}
    for e in edges:
        n1 = tuple(e["node1"])
        n2 = tuple(e["node2"])
        dur = e["base_duration_sec"]
        eid = e["edge_id"]
        adj.setdefault(n1, []).append((eid, n2))
        adj.setdefault(n2, []).append((eid, n1))
        edge_base[eid] = dur

    obs_map = {}
    for o in obstructions:
        eid = o["edge_id"]
        frm = tuple(o["edge"]["from"])
        to = tuple(o["edge"]["to"])
        key = (eid, frm, to)
        obs_map.setdefault(key, []).append(
            (parse_iso(o["start_time"]), parse_iso(o["end_time"]), float(o["speed_factor"]))
        )

    for key in obs_map:
        obs_map[key].sort(key=lambda x: x[0])

    return adj, edge_base, obs_map


# ---------------------------------------------------------------------------
# Time-dependent Dijkstra
# ---------------------------------------------------------------------------

def solve_case(case: dict) -> dict:
    start_coord = tuple(case["start_coordinate"])
    end_coord = tuple(case["end_coordinate"])
    start_epoch = parse_iso(case["start_time"])

    adj, edge_base, obs_map = build_graph(
        case.get("nodes", []), case.get("edges", []), case.get("obstructions", [])
    )

    if start_coord == end_coord:
        return {
            "total_duration_sec": 0,
            "arrival_time": epoch_to_iso(start_epoch),
            "path": [],
        }

    # Note: earliest arrival at a node does NOT necessarily dominate a later
    # arrival at the same node. A speed_factor == 0.0 window combined with the
    # no-waiting rule means an earlier arrival can be "trapped" (its onward
    # edge is blocked right then) while a later arrival at the same node
    # sails through. So we cannot settle a node after its first pop the way
    # plain Dijkstra does. Instead:
    #   - before `cutoff` (the last moment any obstruction is active), allow
    #     every distinct arrival time at a node to be expanded once;
    #   - after `cutoff`, all speed factors are back to 1.0 and normal FIFO
    #     dominance holds again, so the first arrival > cutoff at a node can
    #     be safely settled and later ones pruned.
    # Because the heap always pops the globally smallest pending time next,
    # and every edge only moves time forward, the first time end_coord is
    # popped is provably the minimal reachable arrival time - so we can
    # return immediately without draining the rest of the heap.
    all_ends = [e for lst in obs_map.values() for (_, e, _) in lst]
    cutoff = max(all_ends) if all_ends else start_epoch

    # prev[(node, arrival_time)] = (prev_node, prev_time, edge_id)
    prev = {}
    processed = {}  # node -> set of exact times already expanded
    settled_late = set()  # nodes with a confirmed-optimal arrival > cutoff
    heap = [(start_epoch, start_coord)]
    arrival_epoch = None

    while heap:
        t, node = heapq.heappop(heap)

        if node in settled_late:
            continue
        if t in processed.get(node, ()):
            continue
        processed.setdefault(node, set()).add(t)

        if node == end_coord:
            arrival_epoch = t
            break

        for (eid, neighbor) in adj.get(node, []):
            base_dur = edge_base[eid]
            obs_list = obs_map.get((eid, node, neighbor), [])
            arrival = traverse_edge(t, base_dur, obs_list)
            if arrival is None:
                continue
            if arrival in processed.get(neighbor, ()):
                continue
            key = (neighbor, arrival)
            if key not in prev:
                prev[key] = (node, t, eid)
            heapq.heappush(heap, (arrival, neighbor))

        if t > cutoff + _EPS:
            settled_late.add(node)

    if arrival_epoch is None:
        return {"total_duration_sec": None, "arrival_time": None, "path": []}

    # Reconstruct path by walking back through the specific (node, time) labels.
    path_edges = []
    cur_node, cur_t = end_coord, arrival_epoch
    while (cur_node, cur_t) != (start_coord, start_epoch):
        p_node, p_t, eid = prev[(cur_node, cur_t)]
        path_edges.append(eid)
        cur_node, cur_t = p_node, p_t
    path_edges.reverse()

    duration = arrival_epoch - start_epoch

    return {
        "total_duration_sec": round(duration),
        "arrival_time": epoch_to_iso(arrival_epoch),
        "path": path_edges,
    }


# ---------------------------------------------------------------------------
# HTTP endpoint
# ---------------------------------------------------------------------------

_executor = ThreadPoolExecutor(max_workers=16)


@app.post("/kan-cheong-delivery-driver")
async def kan_cheong_delivery_driver(request: Request):
    batch = await request.json()

    results = {}

    def run(case_id, case):
        try:
            return case_id, solve_case(case)
        except Exception:
            return case_id, {"total_duration_sec": None, "arrival_time": None, "path": []}

    futures = [_executor.submit(run, cid, case) for cid, case in batch.items()]
    for fut in futures:
        cid, result = fut.result()
        results[cid] = result

    return JSONResponse(content=results)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)