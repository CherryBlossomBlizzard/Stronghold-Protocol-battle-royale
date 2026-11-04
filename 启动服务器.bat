@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 卫戍协议：盟约 · 大逃杀 — 服务器启动器
cd /d "%~dp0"

rem ============================================================================
rem  卫戍协议：盟约 · 大逃杀（0.3.1 底座 · 20 人房）
rem  · 端口自选：菜单选一个，或手动输入任意端口（1024-65535）
rem  · 启动前自动检测端口占用：占用进程自动关闭（自动卸载）
rem  · 安全规则：清理其它端口时，监听 3000 的进程一律不动；只有你明确选 3000 时才会清理 3000
rem ============================================================================

set "HOST=::"
set "SP_SERVER_SETTINGS_DIR=runtime"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [错误] 没有找到 Node.js（需要 22 或更高版本）。请先安装，再运行本文件。
  echo          下载：https://nodejs.org/  （选 LTS，安装时勾选 Add to PATH）
  echo.
  pause
  goto end
)
rem ---- Node 版本闸门：本服要求 22+。旧版本会在「node server\index.js」一启动就报语法错并退出，
rem      以前那种情况下窗口跟着关掉，看起来就是「闪退」——这里先拦住并说清楚 ----
set "NODEV="
for /f "delims=" %%V in ('node -v 2^>nul') do set "NODEV=%%V"
set "NODEMAJ="
if defined NODEV for /f "tokens=1 delims=." %%A in ("!NODEV:v=!") do set "NODEMAJ=%%A"
if not defined NODEMAJ (
  echo.
  echo   [错误] 无法识别 Node.js 版本（node -v 没有输出）。请重装 Node 22 或更高版本。
  echo.
  pause
  goto end
)
if !NODEMAJ! LSS 22 (
  echo.
  echo   [错误] Node.js 版本太低：!NODEV!  （本服需要 22 或更高）
  echo          请到 https://nodejs.org/ 装 LTS 版本后再运行本文件。
  echo.
  pause
  goto end
)

:menu
cls
echo ============================================================================
echo    卫戍协议：盟约 · 大逃杀   ·   20 人房   ·   端口自选
echo    维护者：CherryBlossomBlizzard（GitHub）
echo    血量 30 · 卡池角色无限张 · 装备无限量 · 无联防
echo    第 1-13 回合按官方出怪 · 第 14 回合起掷骰子且怪物血量每回合翻倍
echo    第 20 回合首领战（五亿血 · 限时 2 分钟 · 限伤关闭 · 打完即结束）
echo ============================================================================
echo.
node tools\battle-royale.mjs status 2>nul
echo.
echo    -- 选择端口 --------------------------------------------------
echo    [1] 4040  · 本服常用
echo    [2] 4041
echo    [3] 4042
echo    [4] 3000  · 官方默认端口
echo    [5] 8080
echo    [6] 手动输入其他端口
echo    -- 其他操作 --------------------------------------------------
echo    [7] 切换 回合扣血上限 开 / 关
echo    [8] 查看当前规则
echo    [9] 卸载旧版本（升级前清理旧程序文件，保留数据与素材）
echo    [0] 退出
echo.
set "CH="
set /p "CH=请选择："
if "%CH%"=="1" (set "PORT=4040" & goto check)
if "%CH%"=="2" (set "PORT=4041" & goto check)
if "%CH%"=="3" (set "PORT=4042" & goto check)
if "%CH%"=="4" (set "PORT=3000" & goto check)
if "%CH%"=="5" (set "PORT=8080" & goto check)
if "%CH%"=="6" goto askport
if "%CH%"=="7" goto toggle
if "%CH%"=="8" goto show
if "%CH%"=="9" goto uninstall
if "%CH%"=="0" goto end
goto menu

:askport
echo.
set "PORT="
set /p "PORT=请输入端口（1024-65535）："
echo %PORT%| findstr /r /c:"^[0-9][0-9]*$" >nul
if errorlevel 1 (
  echo   [错误] 端口必须是纯数字。
  pause
  goto menu
)
if %PORT% LSS 1024 (
  echo   [错误] 端口不能小于 1024，避免和系统服务冲突。
  pause
  goto menu
)
if %PORT% GTR 65535 (
  echo   [错误] 端口不能大于 65535。
  pause
  goto menu
)
goto check

:check
echo.
echo   == 端口 %PORT% 占用检测 ==
call :freeport %PORT%
goto deps

:deps
if not exist "node_modules" (
  echo   首次运行：安装依赖，npm install …
  call npm install
  if errorlevel 1 (
    echo   [错误] npm install 失败。请检查网络后重试。
    pause
    goto menu
  )
)
if not exist "public\vendor\preact.module.js" (
  echo   首次运行：下载前端运行库，npm run vendor …
  call npm run vendor
  if errorlevel 1 (
    echo.
    echo   [提示] 前端运行库没下成功。界面可能打不开，但不影响服务器启动。
    echo          网络恢复后重新运行本文件即可再试一次。
    echo.
    pause
  )
)
if not exist "public\assets" (
  echo   首次运行：下载美术与音频，npm run setup，可中断，再次运行会续传 …
  call npm run setup
  echo   [提示] 素材没下完也不影响启动，游戏里会自动补齐。
)
rem ---- 卫戍协议 · 大逃杀：皮肤包内置化 —— 缺包、或装的是旧版（没有 plugin.lock.json）时自动下载（98 MB）----
rem      皮肤是可选内容：任何一步失败都只提示、不中断启动，但**不再静默吞掉原因**，并且窗口不会自动关闭。
set "SKIN=plugins\official-skins"
if not exist "%SKIN%\plugin.lock.json" (
  if exist "%SKIN%\plugin.json" (
    echo   检测到旧版皮肤包（没有 plugin.lock.json，战斗里不会出模型），重新下载 …
    rmdir /s /q "%SKIN%" 2>nul
  ) else (
    echo   首次运行：下载官方皮肤包（98 MB，64 套皮肤，其中 62 套含战斗内动态模型）…
  )
  if exist official-skins.zip del official-skins.zip 2>nul
  curl -L --retry 2 -o official-skins.zip "https://github.com/CherryBlossomBlizzard/Stronghold-Protocol-battle-royale/raw/dist/official-skins.zip" >nul 2>nul
  set "ZCURL=!errorlevel!"
  set "ZSZ=0"
  if exist official-skins.zip for %%F in (official-skins.zip) do set "ZSZ=%%~zF"
  if not "!ZCURL!"=="0" (
    echo   [提示] 皮肤包下载失败（curl 退出码 !ZCURL!）—— 跳过。可稍后运行 安装皮肤包.bat
  ) else if !ZSZ! LSS 50000000 (
    rem 98 MB 的包下成几十 KB，通常是 GitHub 的错误页或网络中断 —— 直接判为坏包，别拿去解压
    echo   [提示] 皮肤包不完整（只下到 !ZSZ! 字节）—— 已删除，跳过。可稍后运行 安装皮肤包.bat
    del official-skins.zip 2>nul
  ) else (
    powershell -NoProfile -Command "Expand-Archive -Path 'official-skins.zip' -DestinationPath 'plugins' -Force" >nul 2>nul
    set "ZEXP=!errorlevel!"
    del official-skins.zip 2>nul
    if exist "%SKIN%\plugin.json" (
      echo   皮肤包就绪。玩家在【设置】里打开「官方皮肤包」即可使用（不会替玩家自动开启）。
    ) else (
      echo   [提示] 皮肤包解压失败（PowerShell 退出码 !ZEXP!）—— 跳过，不影响游戏。
      echo          手动补装：右键 安装皮肤包.bat ^> 以管理员身份运行。
      echo.
      pause
    )
  )
)
rem ---- 让新房间默认带上官方皮肤包：写服务器策略 plugins\config.json（已存在就不动，那是房主自己的策略）----
rem      没有这个文件时，新房间默认不带任何插件 → 皮肤包里 51 位干员的外观在【干员调配】里显示为「0 套外观」。
if exist "%SKIN%\plugin.json" if not exist "plugins\config.json" (
  >"plugins\config.json" echo {
  >>"plugins\config.json" echo   "rooms": "host",
  >>"plugins\config.json" echo   "default": ["official-skins"],
  >>"plugins\config.json" echo   "allow": ["*"],
  >>"plugins\config.json" echo   "classes": { "cosmetic": true, "content": true }
  >>"plugins\config.json" echo }
  echo   已写入 plugins\config.json：新房间默认启用官方皮肤包（玩家不用再手动打开）。
)
goto start

:start
echo.
rem ---- 预检：目录不完整时直接说人话（否则 node 抛 MODULE_NOT_FOUND，看起来就是「一闪就没」）----
if not exist "server\index.js" (
  echo   ============================================================
  echo    [错误] 这个文件夹不完整：没找到 server\index.js
  echo   ============================================================
  echo    本文件必须和仓库/发布包里的其它文件放在一起运行。
  echo    常见情况：只单独下载了 启动服务器.bat，或者解压时少解了一层目录。
  echo    做法：把整个发布包完整解压，再双击里面的 启动服务器.bat。
  echo.
  pause
  goto end
)
if not exist "package.json" (
  echo   ============================================================
  echo    [错误] 这个文件夹不完整：没找到 package.json
  echo   ============================================================
  echo    同上 —— 请把整个发布包完整解压后再运行本文件。
  echo.
  pause
  goto end
)
echo   == 启动服务器 ==
echo   端口：%PORT%
echo   启动完成后浏览器打开：   http://localhost:%PORT%
echo   局域网玩家用             http://本机IP:%PORT%  进入。
echo   停止服务器：在本窗口按 Ctrl+C 或直接关掉窗口。
echo.
node server\index.js
set "RC=%errorlevel%"
echo.
if "%RC%"=="0" (
  echo   服务器已正常退出（退出码 0）。
) else (
  echo   ============================================================
  echo    服务器异常退出，退出码 %RC%
  echo   ============================================================
  echo    常见原因 ^(按顺序排查^)：
  echo      1. 端口 %PORT% 被别的程序占用 —— 回菜单换一个端口，或再启动一次让它自动清理
  echo      2. Node 版本低于 22 —— 本服需要 Node 22+，当前版本：
  node -v
  echo      3. 依赖不全或损坏 —— 删掉 node_modules 文件夹后重新运行本文件
  echo      4. 端口小于 1024 —— 需要右键「以管理员身份运行」
  echo      5. 皮肤包/插件损坏 —— 删掉 plugins\official-skins 后重新运行本文件
  echo.
  echo    把上面的报错整段发出来就能定位。
)
echo.
echo   按任意键回到菜单（本窗口不会再自己关闭）。
pause >nul
goto menu

:end
echo.
echo   已退出。按任意键关闭窗口。
pause >nul
exit /b 0

:uninstall
echo.
call "%~dp0卸载旧版本.bat"
goto menu

:toggle
echo.
node tools\battle-royale.mjs lp-cap toggle
echo.
pause
goto menu

:show
echo.
node tools\battle-royale.mjs status
echo.
pause
goto menu

rem ---------------------------------------------------------------------------
rem :freeport <port> — 只清理第 1 个参数这个端口上的 LISTENING 进程（自动卸载）。
rem 安全规则：清理其它端口时，同时监听 3000 的进程一律不动；选的就是 3000 时例外。
rem ---------------------------------------------------------------------------
:freeport
setlocal enabledelayedexpansion
set "P=%~1"
set "P3000= "
if not "%P%"=="3000" (
  for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":3000 " ^| findstr /i LISTENING') do set "P3000=!P3000!%%P "
)
rem 收集去重后的 PID 列表（IPv4 + IPv6 会对同一 PID 报两行）
set "PIDS= "
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%P% " ^| findstr /i LISTENING') do (
  echo !PIDS! | findstr /c:" %%P " >nul || set "PIDS=!PIDS!%%P "
)
if "!PIDS!"==" " (
  echo   [端口 %P%] 空闲，无需清理。
  endlocal
  exit /b 0
)
for %%P in (!PIDS!) do (
  set "PID=%%P"
  set "SKIP="
  if "!PID!"=="0" set "SKIP=1"
  if not "%P%"=="3000" for %%X in (!P3000!) do if "%%X"=="!PID!" set "SKIP=1"
  if defined SKIP (
    echo   [端口 %P%] PID !PID! 也在监听 3000 —— 按安全规则不动它，跳过。
  ) else (
    set "IMG=?"
    for /f "tokens=1 delims=," %%N in ('tasklist /FI "PID eq !PID!" /FO CSV /NH 2^>nul') do if not defined IMGDONE set "IMG=%%~N" & set "IMGDONE=1"
    set "IMGDONE="
    echo   [端口 %P%] 发现 PID !PID! 占用，自动关闭…
    taskkill /PID !PID! /T /F >nul 2>nul
    set "FOUND=1"
  )
)
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %P% -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }" >nul 2>&1
if errorlevel 1 (
  echo   [端口 %P%] 仍有占用，再试一轮…
  endlocal
  call :freeport %P%
  exit /b 0
)
if defined FOUND echo   [端口 %P%] 已释放。
endlocal
exit /b 0
exit /b 0
