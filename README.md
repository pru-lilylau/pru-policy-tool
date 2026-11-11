# pru-policy-tool

保單總覽工具：單一檔案 `index.html`，客人資料以 PIN 加密後存入 GitHub secret gist。

## 自動測試

`tests/smoke.js` 會開一個瀏覽器，用假嘅 GitHub 同 cdnjs（唔會連出去），檢查：

- 儲存去 GitHub 嘅內容同客戶列表名稱都有加密，冇明文個人資料
- 舊版明文記錄會自動加密更新
- 4 位 PIN 轉 6 位 PIN 後，所有記錄用新 PIN 重新加密
- 客戶列表嘅檢視提醒
- 轉移碼 QR 唔會傳去第三方網站
- 儲存 → 讀取後所有欄位不變
- 方案總結自動預填、產品資料表
- 報告：按類型分組、保障總覽、按年歲保額、匯率註明、冇錯誤

```bash
npm i -D playwright && npx playwright install chromium
```

```bash
node tests/smoke.js
```

想連 QR 碼都測，可以用 `QR_LIB=<qrcode-generator 1.4.4 嘅 qrcode.js 路徑>` 指定本地檔案。

## 常改嘅地方（都喺 `index.html`）

- 參考匯率：搜尋 `const FX=`
- 產品特性（儲蓄型／消費型、每5年調整保費、預設疾病數目）：搜尋 `const PLAN_INFO=`
- 計劃清單：搜尋 `const PRODS=`
