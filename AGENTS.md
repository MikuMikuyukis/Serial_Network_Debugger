# Repository Workflow

## Commits

- Commit every completed code, configuration, or documentation change before handing off the work.
- 每次完成代码、配置或文档修改后，都必须在交付前创建 Git commit。
- Every commit message must describe the change in both Chinese and English. Use a concise bilingual subject when practical, and add a bilingual body when more context is needed.
- 每条提交信息都必须使用中英文说明修改内容。简单修改可使用简洁的双语标题，复杂修改应在正文中补充中英文背景。
- Keep each commit focused on one logical change.
- 每个提交只包含一项逻辑完整的修改。

## Remote Operations

- Do not push commits or branches to GitHub unless the user explicitly requests it.
- 除非用户明确要求，否则不要向 GitHub 推送提交或分支。

## Branch Safety

- Make sensitive or high-risk changes on a dedicated branch. This includes authentication and permissions, secrets handling, data migrations, release or deployment configuration, core architecture, destructive behavior, and broad dependency upgrades.
- 涉及认证权限、敏感信息处理、数据迁移、发布部署配置、核心架构、破坏性行为或大范围依赖升级时，必须在独立分支完成。
- Test and commit the branch, then wait for explicit user confirmation before merging it into `main`.
- 在分支上完成测试和提交后，必须等待用户明确确认，才能合并到 `main`。
- Never commit credentials, tokens, private keys, or other secrets.
- 禁止提交密码、令牌、私钥或其他敏感凭据。
