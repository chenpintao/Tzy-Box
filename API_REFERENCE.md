# ZhongYu ToolBox API 参考与安全审计清单

> 本文根据当前前端和本地服务代码整理。未主动请求生产接口，以下“可能漏洞”只是需要在获得明确授权后验证的假设，不代表已经存在漏洞。

## 主 API 配置

前端使用 `window.API_BASE_URL` 作为学校业务 API 基址：

```text
登录前默认：http://sxz.api.zykj.org
登录后：localStorage.apiBaseUrl 或学校发现接口返回的地址
```

学校发现接口：

```http
GET https://hagateway.zykj.org/api/discovery/{schoolCode}
```

所有请求通常使用：

```http
Authorization: Bearer {accessToken}
```

## API 清单

### 认证与用户

```http
POST /api/TokenAuth/Login
POST /api/TokenAuth/RefreshToken
GET  /api/services/app/User/GetInfoAsync
```

### 云笔记

```http
GET  /CloudNotes/api/Notes/GetAll
GET  /CloudNotes/api/Notes/GetByParentId
POST /CloudNotes/api/Notes/AddOrUpdate
POST /CloudNotes/api/Resources/AddOrUpdate
GET/POST /CloudNotes/api/Resources/{endpoint}
```

云笔记的部分参数使用 AES 加密后传输。

### 对象存储与上传

```http
POST /api/services/app/ObjectStorage/GenerateTokenV2Async
```

该接口返回 OSS 临时访问凭据，前端随后使用阿里云 OSS SDK 上传文件。

### 图片库

```http
GET  /api/services/app/PictureLibrary/GetAllPicturesFromLibrary
POST /api/services/app/PictureLibrary/AddPictureAsync
```

### 随身答

```http
GET  /api/services/app/Quora/GetCatalogs
POST /api/services/app/Quora/GetSessions
GET/POST /api/services/app/Quora/GetMessages
GET  /api/services/app/Quora/ResetReadState?sessionId={id}
```

### 错题本

```http
GET  /api/services/app/MistakeBook/GetMyMistakeBooksAsync
POST /api/services/app/MistakeBook/SearchMistakeQstItemsAsync
GET  /api/services/app/MistakeBook/GetMistakeQstItemDetailInfoAsync?itemId={id}
GET  /Question/View/{qstId}?showAnalysis=true
```

### 新测评

```http
POST /api/services/app/Task/GetStudentTaskListAsync
GET  /api/services/app/Task/GetExamTaskAsync?id={id}
GET  /api/services/app/LearningSituations/GetExamOverviewAsync?examId={id}
GET  /api/services/app/LearningSituations/GetQuestionAnalysisAsync?examId={id}
GET/POST /api/services/app/Exam/ExportObjectiveAnswersAsync
```

### 在线课程

```http
GET /SelfStudy/api/Learn/LearningCourses?page={page}
GET /SelfStudy/api/Learn/CourseDetail?id={courseId}
GET /SelfStudy/api/learn/readContent?catalogId={catalogId}&courseId={courseId}
```

### 外部辅助服务

```http
POST https://pdf2img.zyai.cc/upload
GET  https://sfs.zyai.cc:8443/OfficeConvertToPdf/Convert?pptUrl={url}
```

本地图片代理：

```http
GET http://127.0.0.1:8080/image-proxy?url={encodedImageUrl}
```

### 分享服务

```http
POST   {SHARE_SERVER}/api/share/create
GET    {SHARE_SERVER}/api/share/{shareId}/info
POST   {SHARE_SERVER}/api/share/{shareId}
GET    {SHARE_SERVER}/api/shares
DELETE {SHARE_SERVER}/api/share/{shareId}/delete
```

## 领创接口（当前不可用）

当前代码仍配置了已停用域名：

```text
https://zytb-linspirer-api.loshop.com.cn/public-interface.php
```

协议方法包括：

```text
com.linspirer.device.setdevice
com.linspirer.tactics.gettactics
com.linspirer.app.getdetail
com.linspirer.user.getuserinfo
```

## 可能的越权风险假设

以下仅是代码层面的风险假设，应只在自有账号、测试环境或获得书面授权后验证。

### 1. IDOR：云笔记 fileId 越权

相关接口：

```http
GET /CloudNotes/api/Notes/GetByParentId
GET /CloudNotes/api/Resources/{endpoint}
POST /CloudNotes/api/Notes/AddOrUpdate
```

风险假设：服务端如果只校验 Token，不校验 `fileId`、`parentId`、资源所属用户，修改请求中的 ID 可能访问其他用户的笔记。

重点检查：

- `fileId` 是否绑定当前 Token 用户
- `parentId` 是否允许跨用户访问
- 资源下载地址是否只依赖 URL 而不做权限校验

### 2. IDOR：错题和测评 ID 越权

相关参数：

```text
itemId
examId
examTaskId
qstId
```

风险假设：如果详情接口只按 ID 查询，可能读取其他用户的错题、试卷或成绩分析。

### 3. 对象存储授权参数校验不足

接口：

```http
POST /api/services/app/ObjectStorage/GenerateTokenV2Async
```

前端提交：

```text
fc
fr
ft
fe
fo
nonce
ts
sign
```

风险假设：

- `userId` 不是请求体字段，而是由签名或 Token 推断
- `fc` 可被修改为其他业务目录
- `nonce` 或远程文件名可写入任意路径
- 返回的 STS 权限范围过大

安全检查重点：

- STS policy 是否限制到当前用户目录
- 是否限制允许的 `fc` 类型
- 是否限制对象名和文件扩展名
- `sign` 是否包含并校验用户身份

### 4. 云笔记写入越权

接口：

```http
POST /CloudNotes/api/Notes/AddOrUpdate
POST /CloudNotes/api/Resources/AddOrUpdate
```

风险假设：如果服务端信任加密后的字段，而没有再次校验 `fileId` 与当前用户的关系，可能修改或覆盖其他用户的笔记资源。

### 5. 分享接口访问控制不足

接口：

```http
POST /api/share/{shareId}
DELETE /api/share/{shareId}/delete
GET /api/shares
```

风险假设：

- `shareId` 可枚举
- 删除接口只验证 ID，不验证创建者
- 查看次数、过期时间或密码校验只在前端执行
- 分享服务后端使用调用者提交的 `api_base` 和资源 ID，导致跨用户读取

### 6. 学校 API 地址注入

学校发现接口返回 `server`，前端会将其作为 API 基址。

风险假设：如果发现服务返回值未严格限制域名，可能导致：

- Token 被发送到非官方服务器
- 请求被重定向到攻击者控制的地址
- 学校代码造成 API 基址污染

### 7. 本地图片代理 SSRF 风险

当前本地代理已使用域名白名单：

```text
ezy-sxz.oss-cn-hangzhou.aliyuncs.com
friday-note.oss-cn-hangzhou.aliyuncs.com
ezy-word2html-imgs.oss-cn-hangzhou.aliyuncs.com
```

只要白名单继续保持固定，就不应改成允许任意 URL。否则可能被利用访问内网地址或云元数据地址。

### 8. 资源 URL 直接公开

云笔记资源通常保存为 OSS URL。如果 OSS 对象为公开读，拿到 URL 的任何人都可能读取文件。

应检查：

- OSS 是否公共读
- URL 是否带签名有效期
- 删除笔记后 OSS 文件是否仍可访问
- 分享链接是否暴露原始 OSS URL

## 建议的授权测试顺序

不要使用真实他人 ID，也不要批量枚举。建议准备两个测试账号 A/B，仅验证边界：

1. A 创建一条测试笔记，B 尝试读取 A 的 `fileId`。
2. A 创建一条测试错题或测评记录，B 使用 A 的 ID 请求详情。
3. 检查 OSS 临时凭据是否只能写入 A 的目录。
4. 检查分享删除接口是否只能删除创建者自己的分享。
5. 检查过期分享是否仍能通过缓存或直接资源 URL访问。

每次只发一个请求，记录状态码和响应，不做重试、不做枚举、不做压力测试。

## 当前结论

- 主业务 API 均通过 `window.API_BASE_URL` 动态配置。
- 领创 API 是独立固定地址，且当前仍指向已停用的 `loshop.com` 域名。
- 最值得优先审查的是云笔记 `fileId`、错题 `itemId`、测评 `examId`、OSS STS 权限和分享 `shareId` 的对象级授权。
- 以上只是潜在风险点，必须通过授权测试确认，不能直接认定为漏洞。
