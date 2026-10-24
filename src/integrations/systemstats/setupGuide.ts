import type { WidgetSetupGuide } from "@/widgets";

export const systemStatsSetupGuide: WidgetSetupGuide = {
  title: "Set up System Stats",
  summary: "Read metrics visible to the Kokpit process. No monitoring agent, API key or external account is needed; Docker counts are optional.",
  requirement: "CPU, Memory, Network and Load need readable Linux procfs files. Disk uses filesystem statistics. These are local kernel/filesystem views, not per-container cgroup usage. Paths refer to Kokpit’s filesystem; a tile URL does not select another machine. Keep host mounts read-only and limited to what you need.",
  steps: [
    {
      title: "Choose the readings and footprint",
      description: "Select System Stats. New presets enable Choose default fields by tile size: Compact shows CPU/Memory; Wide adds Disk; Detailed shows all six fields, including Docker. For a custom selection, check every field you want. Use default fields removes that override; clearing every selected checkbox intentionally saves an empty widget.",
    },
    {
      title: "Choose the procfs view",
      description: "Leave Proc path empty for KOKPIT_PROC_PATH when configured, otherwise /proc. For an explicit host procfs bind on a Linux Docker host, add /proc:/host/proc:ro to Kokpit’s existing Compose volumes, then enter /host/proc or set KOKPIT_PROC_PATH=/host/proc. Apply deployment changes with docker compose up -d kokpit, using your actual service name and usual project options.",
    },
    {
      title: "Point Disk at the intended filesystem",
      description: "Disk path defaults to / inside Kokpit. To measure another filesystem, mount an existing directory from it, for example /mnt/storage:/host/storage:ro, and enter /host/storage. Keep existing data mounts and recreate the service after mount changes. This reports the containing filesystem’s capacity, not the directory’s file sizes. The README shows bind syntax that rejects missing sources.",
    },
    {
      title: "Choose the network scope and interface",
      description: "Find interface names in the chosen Proc path’s net/dev file as seen inside Kokpit. Enter one exact name, or leave Network interface empty to sum non-loopback interfaces. A host /proc bind alone does not switch the process’s network namespace. For host interfaces on rootful Linux Docker Engine, see the host-networking troubleshooting entry before changing deployment settings.",
    },
    {
      title: "Add Docker access only if selected",
      description: "If Docker is selected explicitly or through Detailed defaults, follow the Docker widget’s socket-mount instructions in the README. Docker socket is the path inside Kokpit; empty uses KOKPIT_DOCKER_SOCKET or /var/run/docker.sock. The published image also needs that environment variable to match a custom destination for startup group setup. Socket access can grant host control even with :ro. Omit the mount when you do not need Docker.",
    },
    {
      title: "Test, save and check each reading",
      description: "Test when enabled, then save and inspect every selected reading; otherwise save and check the tile. The test uses the current fields and footprint, so it does not check unused paths. Optional Docker errors can still produce Connection OK while the tile shows Docker unavailable. Refresh defaults to ten seconds. CPU/network use short samples per refresh, not a history graph or an average over the entire refresh interval.",
    },
  ],
  troubleshooting: [
    {
      title: "Missing /proc, unreadable files or a non-Linux runtime",
      description: "Proc path is the directory containing stat, meminfo, net/dev and loadavg, rather than one of those files. Only selected fields are read: CPU needs stat, Memory needs meminfo, Network needs net/dev, and Load needs loadavg plus stat. Verify the relevant files are readable by Kokpit’s runtime user. There is no macOS/Windows fallback for procfs fields. Use a suitable Linux deployment, or select only other supported fields. Choosing an unused path does not validate its existence until its field is collected.",
    },
    {
      title: "Host figures, container figures and Docker Desktop",
      description: "The widget reads the chosen procfs and filesystem paths; it does not query Docker’s CPU/RAM limits or cgroup accounting. Procfs CPU/memory can reflect the shared kernel rather than a container’s limits. /proc/net resolves through the reading process’s network namespace. Binding host /proc does not change that namespace. On Docker Desktop, Linux procfs describes the Linux environment/VM, not native macOS or Windows measurements. There is no SSH/remote-host URL mode; use an Agent integration such as Netdata for remote monitoring.",
    },
    {
      title: "Reading host network interfaces on rootful Linux Docker Engine",
      description: "On rootful Linux Docker Engine, if you deliberately want Kokpit to share the host’s network namespace, configure network_mode: host on its Compose service, remove ports mappings, then recreate that service. Host networking removes network isolation; Kokpit listens directly on its configured PORT (3000 by default), so check port availability and intended access. Recheck the interface names afterward. Rootless networking depends on Engine/RootlessKit versions: follow Docker’s version-specific instructions and verify the visible interfaces. Docker Desktop does not turn Linux procfs into native desktop-host metrics. Keep the normal container network if that is the scope you want.",
    },
    {
      title: "Zero network rate or an unexpectedly large aggregate",
      description: "Network interface is one exact, case-sensitive name from the visible net/dev file, not a host address or comma-separated list. An absent name gives zero rates rather than a configuration error. lo is always excluded, even if entered explicitly. Empty sums all other interfaces present in both samples, including bridges, virtual devices and tunnels, so the same traffic can be counted on several devices. Choose one relevant interface when that aggregate is unsuitable. Counter resets are clamped to zero per interface; no traffic can also mean a genuine zero.",
    },
    {
      title: "Wrong disk, missing directory or capacity differs from folder size",
      description: "Disk path is independent of Proc path. / means the filesystem visible at Kokpit’s root; choose a container-side bind target to measure another filesystem. Use an existing directory on that filesystem and avoid mounting unrelated host contents. statfs reports capacity, not a recursive directory-size scan. Used is total blocks minus free blocks; Available is free space available to an unprivileged user. Reserved free blocks can make Used + Available smaller than Total. The percentage is Used / Total and can differ from tools using another denominator.",
    },
    {
      title: "Docker unavailable or Connection OK without Docker counts",
      description: "The Docker field is best effort: ordinary socket failures show Docker unavailable while other readings remain. The connection test therefore cannot prove optional Docker access succeeded; inspect the saved tile. Follow the Docker widget’s permissions guide: the published entrypoint checks KOKPIT_DOCKER_SOCKET/default and joins a nonzero owning group, but deliberately skips GID 0. An explicit Docker socket field overrides requests without changing startup setup. Use the same custom destination in the mount and environment. Do not use tcp://, HTTP, SSH or unix:// in this filesystem-path field. An unrestricted rootful socket grants host control; :ro does not enforce read-only API methods.",
    },
    {
      title: "Defaults, custom Fields or an empty widget",
      description: "New editor presets set size_defaults=true. With no explicit Fields list, Compact 3×2 uses CPU/Memory, Wide 6×2 adds Disk, and Detailed 3×4 adds Network/Load/Docker. Missing/false size_defaults preserves the historical CPU/Memory/Disk/Network defaults at every size. An explicit Fields list always wins: check every wanted field, rather than assuming defaults are added to it. Clearing every custom checkbox stores fields: [] and shows No stats to show. Use default fields removes the list; then the size-default checkbox chooses which default set applies. Custom/historical selections remain complete, scrolling on short canvases.",
    },
    {
      title: "What CPU, Memory, Load and refresh mean",
      description: "CPU is aggregate busy time across the visible cpu counters, treating idle + iowait as idle; it is not one process’s CPU use. Memory used is MemTotal minus MemAvailable, falling back to MemFree + Buffers + Cached when MemAvailable is absent. Load shows raw 1/5/15-minute averages, not CPU percentages or values divided by core count. CPU/network are sampled twice, with a 250 ms pause and actual elapsed time for network rates. Refresh defaults to ten seconds; the widget has an eight-second overall fetch budget. Failed required reads can retain previous values with a refresh warning; retrying faster does not create history data.",
    },
  ],
  documentationUrl: "https://github.com/pmyszczynski/kokpit#system-stats",
};
