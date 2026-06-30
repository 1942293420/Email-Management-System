# 邮箱管理平台 (Email Management System)

基于 Django + Django REST Framework + Channels + React 的邮件管理平台。

## 项目结构

```
email-management-system/
├── email-server/          # 后端 (Django + Daphne)
│   ├── config/            # Django 配置
│   ├── mailboxes/         # 邮件核心模块
│   │   ├── imap_sync.py   # IMAP 同步引擎
│   │   ├── views.py       # REST API
│   │   ├── consumers.py   # WebSocket
│   │   └── models.py      # 数据模型
│   └── manage.py
├── email-frontend/        # 前端 (React + Vite)
│   └── src/
│       ├── pages/         # 页面组件
│       ├── components/    # 通用组件
│       └── styles.css     # 全局样式
└── README.md
```

## 启动

### 后端
```bash
cd email-server
daphne -b 0.0.0.0 -p 9122 config.asgi:application
```

### 前端
```bash
cd email-frontend
npm install
npx vite build
npx vite preview --host 0.0.0.0 --port 9123
```
