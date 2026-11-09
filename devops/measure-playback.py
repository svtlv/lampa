#!/usr/bin/env python3
"""Bounded, read-only Linux playback telemetry. No media or application requests."""
import argparse
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import time

DEFAULTS = {
    "torrserver": "torrserver", "jackett": "jackett",
    "api": "svtlvtv_lampa_api", "web": "svtlvtv_lampa_web", "db": "svtlvtv_lampa_db",
}
# Deliberately exclude environments, mounts, probe output, logs and error text.
INSPECT = ('{"name":{{json .Name}},"id":{{json .Id}},"pid":{{.State.Pid}},'
           '"started":{{json .State.StartedAt}},"status":{{json .State.Status}},'
           '"oom_killed":{{.State.OOMKilled}},"restarts":{{.RestartCount}},'
           '"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"none"{{end}}}')
STATES = {"created", "running", "paused", "restarting", "removing", "exited", "dead"}
HEALTH = {"healthy", "unhealthy", "starting", "none"}
MEM_FIELDS = {"MemTotal", "MemAvailable", "MemFree", "Buffers", "Cached", "SwapTotal", "SwapFree"}
CG_MEMORY = {"anon", "file", "kernel", "sock", "slab", "pgfault", "pgmajfault",
             "pgscan", "pgsteal", "pgscan_direct", "pgscan_kswapd", "pgsteal_direct", "pgsteal_kswapd"}
VM_FIELDS = {"oom_kill", "pswpin", "pswpout", "pgmajfault", "pgscan_kswapd", "pgscan_direct",
             "pgsteal_kswapd", "pgsteal_direct"}
EVENTS = {"start", "preload", "seek", "pause", "resume", "stop", "search", "buffering", "recovered"}
ENUMS = {
    "client": {"v" + str(i) for i in range(1, 17)},
    "platform": {"android", "tizen", "webos", "browser", "apple", "other"},
    "player": {"builtin", "external", "other"},
    "route": {"lan", "tailnet", "other"},
    "workload": {"idle", "single_1080p", "distinct_1080p", "same_hash", "single_4k", "mixed", "search"},
}


def number(value, minimum=0):
    if isinstance(value, bool):
        raise ValueError()
    result = float(value)
    if not math.isfinite(result) or result < minimum:
        raise ValueError()
    return result


class Reader:
    def __init__(self):
        self.unavailable = set()

    def text(self, path, label):
        try:
            return path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            self.unavailable.add(label)
            return None

    def parse(self, path, label, parser):
        raw = self.text(path, label)
        if raw is None:
            return None
        try:
            return parser(raw)
        except (ValueError, IndexError, KeyError, TypeError):
            self.unavailable.add(label)
            return None

    def integer(self, path, label):
        return self.parse(path, label, uint)


def uint(raw):
    if type(raw) not in (str, int):
        raise ValueError()
    value = int(raw)
    if value < 0:
        raise ValueError()
    return value


def pairs(raw):
    return {parts[0]: uint(parts[1]) for line in raw.splitlines() if (parts := line.split())}


def selected(raw, fields):
    return {key: value for key, value in pairs(raw).items() if key in fields}


def pressure(raw):
    result = {}
    for line in raw.splitlines():
        parts = line.split()
        if parts[0] not in {"some", "full"}:
            continue
        values = dict(part.split("=", 1) for part in parts[1:])
        result[parts[0]] = {key: number(values[key]) for key in ("avg10", "avg60", "avg300", "total")}
    if "some" not in result:
        raise ValueError()
    return result


class Rates:
    def __init__(self):
        self.previous = {}

    def get(self, key, counters, now):
        previous = self.previous.pop(key, None)
        if counters is None:
            return None
        self.previous[key] = (now, counters)
        result = {name: None for name in counters}
        if previous is not None and now > previous[0]:
            for name, value in counters.items():
                old = previous[1].get(name)
                if old is not None and value >= old:
                    result[name] = round((value - old) / (now - previous[0]), 6)
        return result


class Collector:
    def __init__(self, proc, cgroup, containers, clock=time.monotonic):
        self.proc, self.cgroup = Path(proc), Path(cgroup)
        self.containers, self.clock = containers, clock
        self.rates = Rates()
        self.identities = {}
        self.generations = {}
        self.host_peak = 0
        self.interfaces = {}

    def host(self, read, now):
        def cpu(raw):
            fields = raw.splitlines()[0].split()
            if fields[0] != "cpu" or len(fields) < 9:
                raise ValueError()
            values = [uint(v) for v in fields[1:9]]  # guest ticks already included in user/nice
            return {"total_ticks": sum(values), "idle_ticks": values[3] + values[4]}

        def memory(raw):
            result = {}
            for line in raw.splitlines():
                parts = line.split()
                key = parts[0].rstrip(":")
                if key in MEM_FIELDS:
                    if parts[2] != "kB":
                        raise ValueError()
                    result[key] = uint(parts[1]) * 1024
            if not {"MemTotal", "MemAvailable", "SwapTotal", "SwapFree"} <= result.keys():
                raise ValueError()
            return result

        def disks(raw):
            # Per-device values only; summing stacked partitions/devices double-counts I/O.
            result = {}
            for line in raw.splitlines():
                p = line.split()
                result[str(uint(p[0])) + ":" + str(uint(p[1]))] = {"read_bytes": uint(p[5]) * 512,
                                              "write_bytes": uint(p[9]) * 512}
            return result

        def net(raw):
            # No interface names or addresses leave the process.
            result = {}
            for line in raw.splitlines()[2:]:
                interface, counters = line.split(":", 1)
                if interface not in self.interfaces:
                    self.interfaces[interface] = "if" + str(len(self.interfaces) + 1)
                p = counters.split()
                result[self.interfaces[interface]] = {"rx_bytes": uint(p[0]), "tx_bytes": uint(p[8])}
            return result

        counters = read.parse(self.proc / "stat", "host.cpu", cpu)
        cpu_rates = self.rates.get("host.cpu", counters, now)
        busy = None
        if cpu_rates and cpu_rates["total_ticks"] and cpu_rates["idle_ticks"] is not None:
            busy = round(100 * (1 - cpu_rates["idle_ticks"] / cpu_rates["total_ticks"]), 4)
        mem = read.parse(self.proc / "meminfo", "host.memory", memory)
        if mem:
            mem["used_bytes"] = mem["MemTotal"] - mem["MemAvailable"]
            mem["swap_used_bytes"] = mem["SwapTotal"] - mem["SwapFree"]
            self.host_peak = max(self.host_peak, mem["used_bytes"])
            mem["sampled_peak_used_bytes"] = self.host_peak
        vm = read.parse(self.proc / "vmstat", "host.vm", lambda s: selected(s, VM_FIELDS))
        for field in VM_FIELDS:
            if vm is not None and field not in vm:
                read.unavailable.add("host.vm." + field)
        result = {"cpu": {"counters": counters, "busy_percent": busy}, "memory": mem,
                  "vm_counters": vm, "vm_per_second": self.rates.get("host.vm", vm, now),
                  "pressure": {kind: read.parse(self.proc / "pressure" / kind, "host.pressure." + kind, pressure)
                               for kind in ("cpu", "memory", "io")}}
        for kind, parser, path in (("disk", disks, "diskstats"), ("network", net, "net/dev")):
            items = read.parse(self.proc / path, "host." + kind, parser)
            result[kind] = None if items is None else {
                name: {"counters": values, "bytes_per_second": self.rates.get("host." + kind + name, values, now)}
                for name, values in items.items()}
            # Forget disappeared devices so a reappearing counter cannot bridge a gap.
            active = {"host." + kind + name for name in (items or {})}
            for key in list(self.rates.previous):
                if key.startswith("host." + kind) and key not in active:
                    self.rates.previous.pop(key)
        return result

    def inspect(self, deadline, read):
        remaining = deadline - self.clock()
        if remaining <= 0:
            read.unavailable.add("docker.deadline")
            return {}
        try:
            result = subprocess.run(["docker", "inspect", "--type", "container", "--format", INSPECT,
                                     *self.containers.values()], stdin=subprocess.DEVNULL,
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                    timeout=min(2, remaining), check=False, encoding="utf-8")
        except subprocess.TimeoutExpired:
            read.unavailable.add("docker.timeout")
            return {}
        except (OSError, UnicodeError):
            read.unavailable.add("docker.unavailable")
            return {}
        if result.returncode:
            read.unavailable.add("docker.inspect_failed")
        rows = {}
        for line in result.stdout.splitlines():
            try:
                item = json.loads(line)
                name = item["name"].lstrip("/")
                if name in self.containers.values():
                    rows[name] = item
            except (ValueError, KeyError, AttributeError, TypeError):
                read.unavailable.add("docker.invalid_response")
        return rows

    def container(self, alias, row, read, now):
        label = "containers." + alias
        if row is None:
            read.unavailable.add(label + ".inspect")
            self.identities[alias] = None  # a later return starts a fresh rate baseline
            return {"available": False}
        try:
            pid = uint(row["pid"])
            restarts = uint(row["restarts"])
            if row["status"] not in STATES or row["health"] not in HEALTH or type(row["oom_killed"]) is not bool:
                raise ValueError()
            if not isinstance(row["id"], str) or not re.fullmatch(r"[a-f0-9]{12,64}", row["id"]):
                raise ValueError()
            if not isinstance(row["started"], str):
                raise ValueError()
        except (ValueError, TypeError, KeyError):
            read.unavailable.add(label + ".inspect_invalid")
            self.identities[alias] = None
            return {"available": False}
        result = {"available": True, "status": row["status"], "health": row["health"],
                  "oom_killed": row["oom_killed"], "restarts": restarts, "metrics": None}
        group = None
        if pid and row["status"] in {"running", "paused"}:
            raw = read.text(self.proc / str(pid) / "cgroup", label + ".cgroup")
            if raw:
                paths = [line[3:] for line in raw.splitlines() if line.startswith("0::/")]
                if len(paths) == 1 and paths[0] != "/":
                    candidate = (self.cgroup / paths[0].lstrip("/")).resolve()
                    if self.cgroup.resolve() in candidate.parents:
                        group = candidate
        if group is None:
            read.unavailable.add(label + ".cgroup_v2")
        inode = None
        if group:
            try:
                inode = group.stat().st_ino
            except OSError:
                group = None
                read.unavailable.add(label + ".cgroup_v2")
        identity = (row["id"], row["started"], pid, restarts, str(group), inode)
        if self.identities.get(alias) != identity:
            self.generations[alias] = self.generations.get(alias, 0) + 1
            self.identities[alias] = identity
            for key in list(self.rates.previous):
                if key.startswith(label + "."):
                    self.rates.previous.pop(key)
        result["generation"] = self.generations[alias]
        if group:
            cpu = read.parse(group / "cpu.stat", label + ".cpu", lambda s: selected(s, {
                "usage_usec", "user_usec", "system_usec", "nr_periods", "nr_throttled", "throttled_usec"}))
            cpu_rates = self.rates.get(label + ".cpu", cpu, now)
            if cpu is not None and "usage_usec" not in cpu:
                read.unavailable.add(label + ".cpu.usage_usec")
            result["metrics"] = {
                "cpu_counters": cpu, "cpu_per_second": cpu_rates,
                "cpu_percent": None if not cpu_rates or cpu_rates.get("usage_usec") is None
                else round(cpu_rates["usage_usec"] / 10000, 4),
                "memory_current_bytes": read.integer(group / "memory.current", label + ".memory_current"),
                "memory_peak_bytes": read.integer(group / "memory.peak", label + ".memory_peak"),
                "swap_current_bytes": read.integer(group / "memory.swap.current", label + ".swap_current"),
                "swap_peak_bytes": read.integer(group / "memory.swap.peak", label + ".swap_peak"),
                "memory_stat": read.parse(group / "memory.stat", label + ".memory_stat", lambda s: selected(s, CG_MEMORY)),
                "memory_events": read.parse(group / "memory.events", label + ".memory_events", lambda s: selected(s, {
                    "low", "high", "max", "oom", "oom_kill", "oom_group_kill"})),
                "pressure": {kind: read.parse(group / (kind + ".pressure"), label + ".pressure." + kind, pressure)
                             for kind in ("cpu", "memory", "io")},
            }

            metrics = result["metrics"]
            events = metrics["memory_events"]
            if events is not None and "oom_kill" not in events:
                read.unavailable.add(label + ".memory_events.oom_kill")
            metrics["memory_events_per_second"] = self.rates.get(label + ".events", events, now)
            stat = metrics["memory_stat"]
            reclaim = None if stat is None else {
                key: value for key, value in stat.items() if key.startswith("pg")}
            metrics["memory_stat_per_second"] = self.rates.get(label + ".reclaim", reclaim, now)

            def io(raw):
                totals = {"rbytes": 0, "wbytes": 0, "rios": 0, "wios": 0}
                for line in raw.splitlines():
                    for field in line.split()[1:]:
                        key, value = field.split("=", 1)
                        if key in totals:
                            totals[key] += uint(value)
                return totals

            counters = read.parse(group / "io.stat", label + ".io", io)
            result["metrics"]["io_counters"] = counters
            result["metrics"]["io_per_second"] = self.rates.get(label + ".io", counters, now)
            # Read network counters in this container's network namespace, without entering it.
            def network(raw):
                totals = {"rx_bytes": 0, "tx_bytes": 0}
                for line in raw.splitlines()[2:]:
                    interface, values = line.split(":", 1)
                    if interface.strip() != "lo":
                        fields = values.split()
                        totals["rx_bytes"] += uint(fields[0])
                        totals["tx_bytes"] += uint(fields[8])
                return totals

            net = read.parse(self.proc / str(pid) / "net/dev", label + ".network", network)
            result["metrics"]["network_counters"] = net
            result["metrics"]["network_bytes_per_second"] = self.rates.get(label + ".network", net, now)
            # Recheck PID/cgroup association after reads; discard a mixed-generation sample.
            after = read.text(self.proc / str(pid) / "cgroup", label + ".cgroup")
            try:
                stable = after == raw and group.stat().st_ino == inode
            except OSError:
                stable = False
            if not stable:
                result["metrics"] = None
                self.identities[alias] = None
                read.unavailable.add(label + ".generation_changed_during_sample")
        return result

    def sample(self, deadline):
        read = Reader()
        now = self.clock()
        host = self.host(read, now)
        rows = self.inspect(deadline, read)
        containers = {alias: self.container(alias, rows.get(name), read, self.clock())
                      for alias, name in self.containers.items()}
        return {"host": host, "containers": containers, "unavailable": sorted(read.unavailable),
                "collection_seconds": round(self.clock() - now, 6)}


class Annotations:
    def __init__(self, path):
        self.path = path
        self.seen = set()

    def read(self, elapsed, duration):
        if self.path is None:
            return [], []
        try:
            # Rereading permits appends while bounding memory and avoiding arbitrary file contents.
            descriptor = os.open(self.path, os.O_RDONLY | os.O_NONBLOCK)
            with os.fdopen(descriptor, "rb") as source:
                if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                    return [], ["annotations.not_regular_file"]
                raw = source.read(1048577)
            if len(raw) > 1048576:
                return [], ["annotations.too_large"]
            lines = raw.splitlines(keepends=True)
        except OSError:
            return [], ["annotations.unavailable"]
        events, errors = [], set()
        for line in lines:
            if not line.endswith(b"\n"):  # an in-progress append is read on the next tick
                continue
            digest = hashlib.sha256(line).digest()
            if digest in self.seen:
                continue
            try:
                if len(line) > 4096:
                    raise ValueError()
                item = json.loads(line)
                if not isinstance(item, dict) or not {"offset_seconds", "event", "client"} <= item.keys():
                    raise ValueError()
                allowed = {"offset_seconds", "event", "bitrate_mbps", "viewers"} | ENUMS.keys()
                if item.keys() - allowed or item["event"] not in EVENTS:
                    raise ValueError()
                offset = number(item["offset_seconds"])
                if offset > duration:
                    raise ValueError()
                for key, choices in ENUMS.items():
                    if key in item and item[key] not in choices:
                        raise ValueError()
                if "bitrate_mbps" in item and number(item["bitrate_mbps"]) > 10000:
                    raise ValueError()
                if "viewers" in item and (type(item["viewers"]) is not int or not 0 <= item["viewers"] <= 16):
                    raise ValueError()
                # Require JSON numbers, not strings that could carry private text.
                for key in ("offset_seconds", "bitrate_mbps"):
                    if key in item and type(item[key]) not in (int, float):
                        raise ValueError()
                if offset > elapsed:
                    continue
                self.seen.add(digest)
                events.append(item)
            except (ValueError, TypeError, UnicodeError, OverflowError, RecursionError):
                self.seen.add(digest)
                errors.add("annotations.invalid_record")
        return events, sorted(errors)


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, "invalid collector options; use --help for bounds and syntax\n")


def arguments(argv):
    parser = SafeParser(description=__doc__)
    parser.add_argument("--duration", type=float, default=60, help="seconds, 0.1 to 86400 (default 60)")
    parser.add_argument("--interval", type=float, default=5, help="seconds, 0.1 to 60 (default 5)")
    parser.add_argument("--annotations", help="appendable JSONL file; strict public event schema")
    parser.add_argument("--container", action="append", default=[], metavar="ALIAS=NAME",
                        help="replace default targets; repeat for neighbors (at most 16)")
    parser.add_argument("--proc-root", default="/proc", help=argparse.SUPPRESS)
    parser.add_argument("--cgroup-root", default="/sys/fs/cgroup", help=argparse.SUPPRESS)
    # Suppress argparse's raw argument echo; CLI mistakes may contain private values.
    try:
        args = parser.parse_args(argv)
        if not 0.1 <= number(args.duration) <= 86400 or not 0.1 <= number(args.interval) <= 60:
            raise ValueError()
        containers = {}
        for entry in args.container:
            alias, name = entry.split("=", 1)
            if not re.fullmatch(r"[a-z][a-z0-9_-]{0,31}", alias) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}", name):
                raise ValueError()
            if alias in containers or name in containers.values():
                raise ValueError()
            containers[alias] = name
        if len(containers) > 16:
            raise ValueError()
        args.containers = containers or DEFAULTS
        return args
    except (ValueError, TypeError):
        parser.exit(2, "invalid collector options; use --help for bounds and syntax\n")


def main(argv=None):
    args = arguments(sys.argv[1:] if argv is None else argv)
    started = time.monotonic()
    deadline = started + args.duration
    collector = Collector(args.proc_root, args.cgroup_root, args.containers)
    annotations = Annotations(args.annotations)
    stopped = False

    def stop(_signal, _frame):
        nonlocal stopped
        stopped = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    def emit(kind, **values):
        record = {"schema_version": 1, "type": kind,
                  "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  "elapsed_seconds": round(time.monotonic() - started, 6), **values}
        print(json.dumps(record, separators=(",", ":"), allow_nan=False), flush=True)

    emit("metadata", duration_seconds=args.duration, interval_seconds=args.interval,
         containers=list(args.containers), platform="linux", cgroup_support="v2",
         page_size_bytes=os.sysconf("SC_PAGE_SIZE"))
    samples = 0
    missing = set()
    while not stopped and time.monotonic() < deadline:
        sample = collector.sample(deadline)
        events, errors = annotations.read(time.monotonic() - started, args.duration)
        sample["unavailable"] = sorted(set(sample["unavailable"]) | set(errors))
        missing.update(sample["unavailable"])
        for event in events:
            emit("annotation", **event)
        emit("sample", **sample)
        samples += 1
        # Fixed schedule, skip missed ticks; never burst to catch up after a slow inspect.
        now = time.monotonic()
        next_tick = started + (int((now - started) / args.interval) + 1) * args.interval
        while not stopped and time.monotonic() < min(next_tick, deadline):
            time.sleep(min(0.1, max(0, min(next_tick, deadline) - time.monotonic())))
    events, errors = annotations.read(time.monotonic() - started, args.duration)
    for event in events:
        emit("annotation", **event)
    missing.update(errors)
    emit("summary", samples=samples, reason="signal" if stopped else "duration",
         unavailable=sorted(missing))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:
        sys.exit(1)
    except (OSError, ValueError, TypeError, KeyError, IndexError, OverflowError, RecursionError):
        # Never echo raw paths, external command output, annotation values or tracebacks.
        print("collector failed; check local metric permissions and output destination", file=sys.stderr)
        sys.exit(1)
