# 모니터링 — Prometheus · Loki · Grafana

무엇을 어디서 수집해 어디로 보내는지, 그리고 왜 그렇게 뒀는지.
배포는 [deploy.md](./deploy.md) 에 있다.

Grafana 는 **다른 장비**에 있다 (`grafana.aitestbed.kr` = 180.210.77.62).
저장소만 이 서버에 두고 Grafana 가 조회한다.

```
[NTMS 175.45.193.174]                         [Grafana 180.210.77.62]
  node-exporter     ┐
  cadvisor          │
  postgres-exporter ├→ prometheus ─┐
  redis-exporter    │              ├ nginx /mon/prom/  ←── Grafana
  nginx-exporter    ┘              │      /mon/loki/
  도커 로그 → alloy → loki ────────┘
```

**포트를 새로 열지 않는다.** 전부 `ntms-net` 안에만 살고, 밖으로 나가는
창구는 nginx 의 `/mon/prom/` `/mon/loki/` 둘뿐이며 Grafana 장비 IP 로만
열려 있다. 밖에서 부르면 403 이다.

Grafana 에 등록된 데이터소스 URL:

| 종류 | URL |
|---|---|
| Prometheus | `http://www.qqq.ai.kr/mon/prom` |
| Loki | `http://www.qqq.ai.kr/mon/loki` |

Loki 주소에 `/loki` 를 또 붙이지 않는다. Grafana 가 스스로 `/loki/api/v1/…`
을 붙이므로 `/mon/loki/loki/api/v1/…` 로 들어와 맞아떨어진다.

## 알아 둘 것

- **basic auth 를 일부러 안 걸었다.** 평문 HTTP 라 인증을 걸면 15초마다
  비밀번호가 그대로 흘러간다. 출발지 IP 로 막는 편이 낫다. HTTPS 를 켜면
  그때 얹는다.
- **Grafana 장비의 아웃바운드 IP 가 A 레코드와 다를 수 있다**(NAT).
  데이터소스 테스트가 403 이면 실제 출발지를 본다. **access.log 를 grep 하지
  말 것** — nginx 이미지에서 그 파일은 `/dev/stdout` 심볼릭 링크라 grep 이
  파이프를 열고 EOF 를 기다리며 영영 안 끝난다(`nginx-logs` 볼륨에도 심볼릭
  링크만 들어 있다. 파일로 남는 로그가 애초에 없다).

  로그는 도커 stdout 으로 나가고 Alloy 가 Loki 로 넣으므로 Loki 에 묻는다.
  거부된 요청은 `access forbidden by rule, client: <IP>` 로 남는다.

  ```bash
  ssh ntms "curl -s -G http://127.0.0.1/mon/loki/loki/api/v1/query_range \
    --data-urlencode 'query={container=\"ntms-nginx\"} |= \"/mon/\"' \
    --data-urlencode since=24h --data-urlencode limit=40"
  ```
- **DB 는 전용 롤로 붙는다.** `ntms_exporter` 는 `pg_monitor` 만 가진다 —
  통계 뷰만 읽고 `ntms` 스키마의 행은 못 본다. 비밀번호 발급·교체는
  `bash docker/monitoring/create-exporter-role.sh` (서버에서 만들어 `.env` 에
  직접 넣는다. 사람 손을 안 거친다).
- **보관 기간**: Prometheus 15일, Loki 14일. Loki 는 컴팩터가 실제로 지운다
  (`retention_enabled: true` 를 빼면 기한만 적어 두고 디스크는 계속 찬다).
- **자원**: 여덟 컨테이너 합쳐 약 220MB · CPU 1% 미만. 상한은 넉넉히 잡아
  두었다(cAdvisor 384M, Prometheus 1G, Loki 768M).
- `deploy.sh` 의 헬스 검증은 컨테이너 다섯을 **명시적으로** 돈다. 여기에
  서비스를 더해도 배포 검증이 깨지지 않는 이유다.

## 자주 볼 것

| 질문 | 어디서 |
|---|---|
| 디스크가 언제 차나 | Metrics Drilldown → `node_filesystem_avail_bytes` |
| DB 커넥션이 천장(20)에 닿았나 | `pg_stat_activity_count` |
| 컨테이너가 재시작하고 있나 | `container_start_time_seconds` |
| 로그인 429 가 났나 | Logs Drilldown → `container=ntms-api` |
| 배포 직후 에러 | Logs Drilldown → `stream=stderr` |

앱 자체 지표(창구별 지연·에러율)는 아직 없다. NestJS 에 `prom-client` 를
붙이고 `/metrics` 를 열면 되는데, 그 창구도 `/mon/` 처럼 밖에서 막아야 한다.
