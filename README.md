# 記帳本

給自己用的手機記帳 Web App。存款與信用卡分開管理、一筆消費可拆成多個分類、信用卡分期與每期卡費自動計算、收到銀行帳單時對帳補記，並有每月分類報表。

技術：Node.js（Express）＋ PostgreSQL（Neon 免費方案），前端是不需要打包的原生 JavaScript，部署在 Render 免費方案，加到 iPhone 主畫面就能像 App 一樣使用。

## 功能

- **總覽**：存款餘額、信用卡未繳、淨資產、本月支出與分類比例、最近交易
- **帳戶**：存款帳戶與信用卡分開顯示，餘額即時計算；存款可「校正餘額」
- **記一筆**：支出／收入／轉帳；一筆消費可加多個品項，每個品項各自選分類，金額自動加總
- **信用卡帳單**：依結帳日自動把消費歸到對應期別；帳單頁顯示一般消費＋本期分期
- **分期**：零利率、年利率（等額本息）、每期固定手續費；每期本金與利息自動入帳到對應帳單
- **對帳**：輸入銀行帳單金額，勾選有出現的消費（沒勾的移到下期），補記沒記到的海外刷卡，差額歸零才完成
- **報表**：每月各分類金額、筆數、佔比與圓環圖
- **分類管理**：新增、改名、換顏色、排序、封存
- 密碼登入（單一使用者）

## 本機執行

需要 Node.js 22 以上。

```bash
npm install
cp .env.example .env      # 填入 DATABASE_URL、APP_PASSWORD、SESSION_SECRET
npm run db:init           # 建立資料表與預設分類（已建立過會自動略過）
npm run dev               # http://localhost:3000
```

`DATABASE_URL` 可以直接用 Neon 的連線字串，也可以用本機的 PostgreSQL。

## 建立 Neon 資料庫

1. 到 [neon.com](https://neon.com) 註冊並建立一個 Project（Region 選離台灣近的，例如 Singapore）。
2. 在 Project 的 **Connect** 取得連線字串（`postgresql://...?sslmode=require`），填到 `.env` 的 `DATABASE_URL`。
3. 本機執行 `npm run db:init` 建立資料表。
   也可以把 `db/schema.sql` 的內容貼到 Neon 的 SQL Editor 執行，效果一樣。

## 部署到 Render

1. 把這個專案推到 GitHub：

   ```bash
   git init
   git add .
   git commit -m "記帳本初版"
   git branch -M main
   git remote add origin https://github.com/<你的帳號>/<repo 名稱>.git
   git push -u origin main
   ```

2. 在 Render 選 **New → Blueprint**，選這個 repo，Render 會讀取 `render.yaml` 自動建立服務。
   （也可以選 **New → Web Service**：Build Command `npm install`、Start Command `npm start`。）
3. 在服務的 **Environment** 設定：
   - `DATABASE_URL`：Neon 連線字串
   - `APP_PASSWORD`：登入密碼
   - `SESSION_SECRET`：Blueprint 會自動產生；手動建立的話自己填一串長的隨機字
4. 部署完成後打開網址，用 `APP_PASSWORD` 登入。

Render 免費方案閒置約 15 分鐘會休眠，之後第一次打開要等幾十秒喚醒；Neon 閒置時也會自動暫停，第一個請求會稍慢一點。

## 加到 iPhone 主畫面

用 Safari 打開網址 → 分享 → **加入主畫面**。之後從主畫面開啟就是全螢幕，沒有網址列。

## 使用說明

### 信用卡的結帳日與繳款日

- 消費日在結帳日（含）之前，算進當月結帳的那一期；之後就算下一期。
- 繳款日如果比結帳日晚，視為同一個月繳款（例如結帳 2 日、繳款 20 日）；否則視為下個月（例如結帳 25 日、繳款 10 日）。
- 「信用卡未繳」計算已入帳的消費（日期已到，或該期已對帳）減掉繳款。

### 對帳

收到銀行帳單後，到信用卡的本期帳單按「開始對帳」：

1. 輸入銀行帳單的應繳金額。
2. 勾選帳單上有出現的消費；沒勾的會在完成對帳後自動移到下一期。
3. 帳單上有、但自己沒記到的（海外刷卡、自動扣款）用「補一筆」補上；小額差額可以一鍵記成「國外交易手續費」。
4. 差額為 0 時按「完成對帳」，之後再按「記錄繳款」從存款帳戶轉帳到信用卡。

### 分期

建立分期時會產生一筆「購買紀錄」（不影響卡費餘額）和每一期的入帳交易（本金＋利息，利息歸在「利息」分類）。

報表計算方式可以選：

- **刷卡當月全額**：分類報表在刷卡那個月計入全額，之後每期只計利息。
- **按期攤到每月**：分類報表每個月計入當期本金＋利息。

分期建立後如果要修改，請到帳單頁的分期列表刪除後重建。

## 專案結構

```
db/schema.sql              資料表、計算餘額與報表的 view、預設分類
scripts/db-init.js         建立資料表（--force 會清空重建）
src/server.js              Express 入口、登入、路由
src/auth.js                密碼登入與 cookie 簽章
src/lib/statements.js      信用卡帳單期別計算
src/lib/installments.js    分期本金、利息試算
src/routes/                API
public/                    前端（index.html、css、js/views）
render.yaml                Render 部署設定
```

## API

所有 `/api/*`（除了登入）都需要登入 cookie。

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| POST | `/api/login`、`/api/logout` | 登入、登出 |
| GET | `/api/dashboard` | 總覽數字 |
| GET/POST | `/api/accounts` | 帳戶列表（含餘額與本期帳單）、新增 |
| GET/PUT | `/api/accounts/:id` | 單一帳戶、編輯或封存 |
| POST | `/api/accounts/:id/adjust` | 校正存款餘額 |
| GET/POST | `/api/categories` | 分類 |
| PUT | `/api/categories/:id` | 改名、換色、封存 |
| POST | `/api/categories/reorder` | 排序 |
| GET/POST | `/api/transactions` | 交易（可用 `month`、`account_id`、`statement_id` 篩選） |
| GET/PUT/DELETE | `/api/transactions/:id` | 單筆交易 |
| GET | `/api/accounts/:id/statements` | 某張卡的帳單列表 |
| GET | `/api/accounts/:id/statements/for-date` | 某天所屬的帳單 |
| GET | `/api/statements/:id` | 帳單摘要 |
| POST | `/api/statements/:id/reconcile` | 對帳 |
| POST | `/api/statements/:id/pay` | 記錄繳款 |
| POST | `/api/installments`、`/api/installments/preview` | 建立分期、試算 |
| GET | `/api/accounts/:id/installments` | 某張卡的分期 |
| DELETE | `/api/installments/:id` | 刪除分期 |
| GET | `/api/reports/monthly?month=YYYY-MM&type=expense` | 每月分類報表 |

## 備份

Neon 本身有時間點還原；也可以定期匯出：

```bash
pg_dump "$DATABASE_URL" > backup.sql
```

## 之後可以加的

資料表已經預留，但目前還沒有畫面：

- 訂閱／固定支出自動產生交易（`subscriptions`）
- 專項收支追蹤（`projects`）
- 雲端發票匯入（`transactions.source = 'import'`）
