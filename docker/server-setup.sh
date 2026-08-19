#!/usr/bin/env bash
# =====================================================================
# NTMS 서버 최초 준비 — Rocky Linux 8 (NAVER Cloud 단일 VM)
#
#   sudo bash docker/server-setup.sh
#
# 서버당 한 번만 실행한다. 여러 번 실행해도 안전하도록 작성했다.
#
# 하는 일
#   1. 사전 점검 (root · 디스크 · 80 포트 점유)
#   2. Docker CE + compose 플러그인 설치 및 부팅 자동 기동 등록
#   3. firewalld 에 http/https 허용
#   4. 타임존 Asia/Seoul
#   5. 배포 디렉터리 준비
#
# 하지 않는 일
#   - SELinux 를 끄지 않는다. 컨테이너가 호스트 파일을 읽어야 하는 지점은
#     docker-compose.yml 의 바인드 마운트에 :z 를 붙여 해결했다.
#   - .env 를 만들지 않는다. 시크릿은 사람이 직접 넣는다. docker/README.md 참고.
# =====================================================================
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/ntms}"

say()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[주의] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[중단] %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------
say "1/5  사전 점검"
# ---------------------------------------------------------------------
[ "$(id -u)" -eq 0 ] || die "root 로 실행해야 한다. sudo bash $0"

free_gb=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
echo "  루트 파티션 여유 공간: ${free_gb}GB"
[ "$free_gb" -ge 10 ] || warn "이미지 빌드에 약 5GB 가 필요하다. 여유 공간을 확보할 것."

echo "  SELinux: $(getenforce 2>/dev/null || echo '없음')"
echo "  메모리 : $(free -h | awk '/^Mem:/{print $2}')"
echo "  CPU    : $(nproc) core"

# 80 포트를 이미 누가 쓰고 있으면 nginx 컨테이너가 뜨지 못한다.
if ss -tlnp 2>/dev/null | awk '{print $4}' | grep -qE '(^|:)80$'; then
    warn "80 포트를 이미 점유한 프로세스가 있다:"
    ss -tlnp | awk 'NR==1 || $4 ~ /(^|:)80$/'
    warn "배포 전에 종료해야 한다.  예) pkill -f 'http.server'"
fi

# ---------------------------------------------------------------------
say "2/5  Docker CE 설치"
# ---------------------------------------------------------------------
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "  이미 설치되어 있다: $(docker --version)"
else
    dnf -y install dnf-plugins-core git
    dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

    # Rocky 8 기본 이미지의 podman/buildah 는 containerd.io 와 충돌한다.
    # --allowerasing 으로 충돌 패키지를 정리하며 설치한다.
    dnf -y install --allowerasing \
        docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin

    echo "  설치 완료: $(docker --version)"
fi

# restart: unless-stopped 가 재부팅 후에도 살아나려면 docker 자체가 자동 기동돼야 한다.
systemctl enable --now docker
echo "  docker 서비스: $(systemctl is-active docker) / 자동기동 $(systemctl is-enabled docker)"

# ---------------------------------------------------------------------
say "3/5  방화벽(firewalld) 허용"
# ---------------------------------------------------------------------
if systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-service=http  >/dev/null
    firewall-cmd --permanent --add-service=https >/dev/null
    firewall-cmd --reload >/dev/null
    echo "  허용된 서비스: $(firewall-cmd --list-services)"
else
    echo "  firewalld 가 꺼져 있다. 외부 차단은 ACG 가 담당한다."
fi

# ---------------------------------------------------------------------
say "4/5  타임존"
# ---------------------------------------------------------------------
timedatectl set-timezone Asia/Seoul
echo "  $(timedatectl | awk '/Time zone/{$1=$1;print}')"

# ---------------------------------------------------------------------
say "5/5  배포 디렉터리"
# ---------------------------------------------------------------------
mkdir -p "$DEPLOY_DIR"
echo "  $DEPLOY_DIR 준비됨"

cat <<GUIDE

준비가 끝났다. 다음 순서로 진행한다.

  1) .env 작성 — 시크릿 생성 방법은 docker/README.md 2장 참고
       cp .env.example .env && vi .env && chmod 600 .env

     최소한 이 다섯 개는 반드시 바꾼다:
       PUBLIC_ORIGIN  POSTGRES_PASSWORD  REDIS_PASSWORD
       JWT_ACCESS_SECRET  JWT_REFRESH_SECRET

  2) 배포
       bash docker/deploy.sh

GUIDE
