# ghcr.io/good7ob/runner：托管执行设备镜像

给运营托管 AI 员工用的镜像。里面预装了 good7ob CLI、Claude Code、git 和 gh。

- 首次启动：用接入令牌（`G7B_ENROLL`）兑换员工 Key，写入卷里的 `runner` 配置档。
- 之后每次启动：直接运行 `good7ob --profile runner agent listen`，领取并执行这名员工的任务。

**一个容器只服务一名员工。** 托管多名员工（或多个组织）时，每人起一个容器，各用各的卷。不要两个容器共用一个卷。

## 1. 开通（首次启动）

在后台「运营与用户 → 用户反馈」里打开这条托管申请，点「生成接入令牌」，复制给出的命令，在托管机器上运行：

```sh
docker run -d --name g7b-<组织>-<员工> --hostname g7b-<组织>-<员工> --restart on-failure \
  -v g7b-<组织>-<员工>:/data \
  -e G7B_ENROLL=<接入令牌> \
  -e G7B_API_URL=<API 地址> \
  ghcr.io/good7ob/runner
```

| 参数 | 说明 |
|---|---|
| `--name` | 容器名。建议与卷同名，例如 `g7b-org115-emp41`。 |
| `--hostname` | 可选。设备列表里显示的主机名，不设时是一串容器 id。 |
| `--restart on-failure` | 异常退出时自动重启。Key 失效时容器以退出码 6 结束，`docker ps -a` 里能看到。 |
| `-v …:/data` | 必填。配置档（员工 Key、主机 id、模型 Key、日志、任务工作目录）都在这个卷里。删掉卷就要重新接入。 |
| `G7B_ENROLL` | 接入令牌（`g7e_…`），24 小时内有效，只能用一次。只在首次启动时使用；之后重启会自动跳过，令牌过期也不影响。 |
| `G7B_API_URL` | 平台 API 地址。不填时用正式站 `https://api.good7ob.com`；dev 托管填 `https://api.good7ob.net`。只在兑换时使用，之后以配置档里保存的为准。 |

开通成功后，平台在这台设备第一次心跳时自动把托管申请设为「已解决」，并通知申请人。

### 模型凭证

- **默认**：组织在平台上保存了模型 Key，兑换时会一起下发，写进配置档的 `env` 文件（权限 600）。不需要再传任何模型 Key。
- **托管机器自备模型凭证**：生成令牌时勾选了这一项，就不会下发组织的模型 Key。这时必须用 `-e` 传入以下任意一个，否则容器启动失败，并提示缺少模型凭证：
  - `ANTHROPIC_API_KEY`：Anthropic API Key。
  - `CLAUDE_CODE_OAUTH_TOKEN`：在任意一台已登录 Claude Code 的电脑上运行 `claude setup-token` 生成的长期令牌。

  ```sh
  docker run -d --name g7b-org115-emp41 --restart on-failure \
    -v g7b-org115-emp41:/data \
    -e G7B_ENROLL=<接入令牌> -e G7B_API_URL=<API 地址> \
    -e ANTHROPIC_API_KEY=<你的 key> \
    ghcr.io/good7ob/runner
  ```

  不想把 key 写在命令行里时，可以写进一个权限 600 的文件，改用 `--env-file <文件>`。

### 仓库访问（可选）

任务需要克隆私有仓库、推送分支或创建 PR 时，传入 `-e GH_TOKEN=<GitHub token>`。容器启动时会执行 `gh auth setup-git`，git 和 gh 都会使用这个 token。

提交作者默认是 `good7ob runner <runner@good7ob.invalid>`。需要改时，传入 `GIT_AUTHOR_NAME`、`GIT_AUTHOR_EMAIL`、`GIT_COMMITTER_NAME`、`GIT_COMMITTER_EMAIL`。

## 2. 看日志

```sh
docker logs -f g7b-org115-emp41          # 接入、注册、心跳、领取任务
docker ps -a --filter name=g7b-          # 状态和退出码，例如 Exited (6)
```

在容器里查看更多：

```sh
docker exec g7b-org115-emp41 good7ob agent status             # 当前任务和工作槽
docker exec g7b-org115-emp41 sh -c 'ls ~/.good7ob-profiles/runner/runs'   # 每个任务的 Claude Code 输出
docker exec g7b-org115-emp41 sh -c 'tail -n 100 ~/.good7ob-profiles/runner/runner.log'
```

容器里已经设置了 `GOOD7OB_PROFILE=runner`，所以 `docker exec … good7ob …` 默认使用这名员工的配置档。

## 3. Key 失效后重建

员工 Key 被吊销或轮换后（例如在别处重新接入了这名员工），日志里会出现：

```
[g7b-runner] ✗ Key 已失效，请重新生成接入令牌并重建容器
```

容器以退出码 6 停止。处理步骤：

1. 在后台为这条托管申请重新生成接入令牌。
2. 删除旧容器，保留卷，用新令牌重建：

   ```sh
   docker rm -f g7b-org115-emp41
   docker run -d --name g7b-org115-emp41 --restart on-failure \
     -v g7b-org115-emp41:/data \
     -e G7B_ENROLL=<新的接入令牌> -e G7B_API_URL=<API 地址> \
     ghcr.io/good7ob/runner
   ```

   容器发现 `G7B_ENROLL` 不是上次接入用的令牌，会重新兑换。主机 id 保存在卷里，设备列表里仍是同一台设备。

需要彻底重来时，先运行 `docker volume rm g7b-org115-emp41`，再按第 1 节开通。

## 4. 停用

```sh
docker rm -f g7b-org115-emp41            # 停止并删除容器；卷还在，之后可以直接重建
docker volume rm g7b-org115-emp41        # 连同 Key 和配置一起删除
```

不再托管这名员工时，记得在平台上把这台执行设备停用。

## 5. 退出码

| 退出码 | 含义 |
|---|---|
| 0 | 正常停止（`docker stop`）。 |
| 1 | listen 的其他错误，或兑换失败（原因见日志）。 |
| 2 | 缺少设置：没有接入也没有 `G7B_ENROLL`；缺少模型凭证；`/data` 不可写。 |
| 6 | 员工 Key 已失效，需要重新接入（见第 3 节）。 |

## 6. 构建镜像

- 打 `v*` tag 时，`.github/workflows/runner-image.yml` 会构建并推送 `ghcr.io/good7ob/runner:<版本>` 和 `:latest`。tag 必须与 `package.json` 的版本号一致。
- 本地构建（在仓库根目录运行）：

  ```sh
  docker build -f docker/runner/Dockerfile -t ghcr.io/good7ob/runner:dev .
  ```

  可以用 `--build-arg CLAUDE_CODE_VERSION=<x.y.z>` 固定 Claude Code 的版本，默认装最新版。

镜像以非 root 用户 `node`（uid 1000）运行，`HOME=/data/home`。用宿主机目录代替命名卷时，先把目录属主改为 uid 1000。
