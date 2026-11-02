# Stand-in for a fresh Debian 13 VPS, used ONLY by
# .github/workflows/deploy-dryrun.yml to run docs/deploy.md end to end.
# Boots real systemd as PID 1 — run it with:
#   docker run -d --privileged --cgroupns=host \
#     -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock <image>
#
# Keep this close to a bare provider image: everything the runbook needs
# must come from setup-server.sh, not from here. Deliberate exceptions:
# - sudo: setup-server.sh/deploy.sh use it but never install it (provider
#   images may or may not ship it — see the dry-run report / review notes).
# - openssh-server + a root authorized key: so the sshd checks/hardening in
#   setup-server.sh have a real sshd to talk to (a VPS always has one).
FROM debian:trixie

ENV container=docker \
	DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		systemd systemd-sysv dbus sudo openssh-server \
	&& rm -rf /var/lib/apt/lists/*

# Units that are pointless (or touch host devices) in a privileged container.
RUN systemctl mask \
		systemd-udevd.service systemd-udevd-kernel.socket systemd-udevd-control.socket \
		systemd-modules-load.service systemd-remount-fs.service systemd-firstboot.service \
		sys-kernel-config.mount sys-kernel-debug.mount sys-kernel-tracing.mount \
		getty.target console-getty.service \
	&& systemctl enable ssh.service

# "Your key is already in root's authorized_keys" (runbook §4, ssh-copy-id).
RUN install -d -m 700 /root/.ssh \
	&& ssh-keygen -q -t ed25519 -N '' -C dryrun -f /root/.ssh/dryrun_key \
	&& cp /root/.ssh/dryrun_key.pub /root/.ssh/authorized_keys \
	&& chmod 600 /root/.ssh/authorized_keys

STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
