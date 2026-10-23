import type { WidgetSetupGuide } from "@/widgets";

export const dockerSetupGuide: WidgetSetupGuide = {
  title: "Connect Docker",
  summary: "Show this Docker Engine’s container counts and a name-sorted list. No API key or Docker Hub login is needed.",
  requirement: "Kokpit needs permission to connect to a Unix socket for a running Docker Engine. Access to a rootful daemon can grant root-level host control: a :ro socket mount does not restrict API methods. Grant this access only to a trusted deployment. Kokpit itself makes GET requests only.",
  steps: [
    {
      title: "Locate the daemon’s Unix socket",
      description: "On the Docker daemon host, find the actual socket. Standard Linux installations normally use /var/run/docker.sock. Rootless Docker normally uses $XDG_RUNTIME_DIR/docker.sock, often /run/user/1000/docker.sock; use the daemon user’s actual path. Check that the path is a socket, not a directory. There is no API key to generate.",
    },
    {
      title: "Mount it into Kokpit",
      description: "In your Compose file, add /var/run/docker.sock:/var/run/docker.sock:ro to the Kokpit service’s existing volumes. Keep its data/config mounts. If your host socket is elsewhere, replace only the left-hand source path; the right-hand path is where Kokpit sees it. The README also shows long syntax that rejects a missing host path.",
    },
    {
      title: "Apply the container configuration",
      description: "From the Compose project directory, run docker compose up -d kokpit, replacing kokpit with your actual service name and using the project’s usual file/profile options. Compose recreates the service when its configuration changes. A plain container restart does not add a new bind mount. For a source installation, grant its runtime user appropriate access to the local socket instead.",
    },
    {
      title: "Set the path inside Kokpit",
      description: "Leave Socket path empty for KOKPIT_DOCKER_SOCKET when configured, otherwise /var/run/docker.sock. Enter a different container destination only if you actually mounted the socket there. With the published image, also set KOKPIT_DOCKER_SOCKET to that destination before recreating it so startup group setup checks the same socket. Do not enter a URL or unix:// prefix.",
    },
    {
      title: "Choose rows, test and save",
      description: "Set Max rows to a whole number from 1–50, or leave it empty for 10. Test when enabled and wait for Connection OK, then save; otherwise save and check the tile. It lists running, paused and restarting containers alphabetically. The running/total summary covers the whole connected Engine, independently of the row limit. Refresh defaults to 15 seconds.",
    },
  ],
  troubleshooting: [
    {
      title: "Socket not found, or the path is a directory",
      description: "Check both sides of the mount: source is a socket on the Docker daemon host; destination is its path inside Kokpit. The standard destination is /var/run/docker.sock. Short Compose volume syntax can create a directory when the source does not exist; fix the source path and use the README’s bind.create_host_path: false example to fail instead. Apply mount changes by recreating the correct service. Typing a Socket path in this form does not create a mount or start Docker.",
    },
    {
      title: "Permission denied or startup warns about GID 0",
      description: "The published production image’s entrypoint checks KOKPIT_DOCKER_SOCKET or the default path before dropping to the nextjs user. For a socket with a nonzero owning GID, it adds that user to the matching group; the socket must still grant that group permission to connect. It deliberately skips GID 0. Custom images, overridden users/entrypoints, rootless/user-namespace mappings and host security policies can differ. Have the administrator arrange a dedicated permitted group or restricted socket service; do not make the socket world-writable or add privileged mode as a shortcut.",
    },
    {
      title: "Custom destination or environment changes",
      description: "Path selection is explicit Socket path first, then the server’s KOKPIT_DOCKER_SOCKET environment variable, then /var/run/docker.sock. The image’s startup group adjustment reads only the environment/default, not widget configuration. For a custom destination, mount it there and set the same environment value before recreating Kokpit. A per-service path override alone does not initialize permissions for another socket. Use a valid nonempty environment path, or unset the variable to use the default.",
    },
    {
      title: "Remote daemon, Docker context or Docker Desktop",
      description: "This widget accepts a filesystem Unix socket path only. It does not read DOCKER_HOST, Docker CLI contexts or Docker Hub credentials, and it cannot directly use tcp://, http(s)://, ssh:// or Windows named-pipe endpoints. Docker Desktop/rootless installations can use different socket paths and ownership; inspect the actual daemon endpoint rather than assuming the standard Linux socket exists. Bind sources belong to the daemon host, not the computer running the Docker CLI. A browser-only Portainer/Docker management URL is not a socket path; the optional tile URL is a separate browser link.",
    },
    {
      title: "API, version or filtered-proxy errors",
      description: "Kokpit negotiates an API version through GET /_ping and its Api-Version response header, then requests the versioned /containers/json?all=1 endpoint. A filtered socket service must permit both reads and preserve that header. Without a usable version header, Kokpit falls back to API 1.44, which the Engine must support. Each socket request has a three-second timeout. A daemon upgrade/downgrade can cause one list request to fail before the next refresh renegotiates. A TCP socket proxy needs an appropriately restricted private Unix bridge; its :2375 address cannot be pasted into Socket path.",
    },
    {
      title: "Counts differ from rows or containers are missing",
      description: "Total counts every container returned by this Engine, including stopped ones and Kokpit itself when present. Running counts only state running; paused/restarting do not count as running but do appear in the list. Rows are filtered to those three states, sorted by name and then capped by Max rows. Green means running; amber means paused/restarting. The status text comes from Docker and can include uptime or restart state. There are no project, name, health, image or Swarm-cluster filters, and no per-container CPU/RAM stats. This is one Engine’s container list, not every Swarm node’s inventory.",
    },
    {
      title: "Read-only mounts and safer access policies",
      description: "A :ro bind protects the mounted filesystem entry; it does not make the Engine API read-only. Someone who can use an unrestricted rootful daemon socket can control the host. Kokpit only sends GET /_ping and the container-list request, and exposes a parsed subset of the response. If you require API enforcement, use a separately configured filtered socket service with only the necessary read routes and a private, permission-restricted Unix bridge. Keep mutating routes blocked and do not publish an unauthenticated Docker TCP listener. Follow the Docker/socket-proxy documentation linked from the README.",
    },
  ],
  documentationUrl: "https://docs.docker.com/engine/storage/bind-mounts/",
};
