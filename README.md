# UpscaleCanva

Windows에서 실행하는 로컬 AI 이미지 업스케일 도구입니다. 현재 웹 화면 이름은 **ARION Upscale Studio**이며, Real-ESRGAN 모델을 사용해 원본의 가로·세로를 각각 2배로 확대합니다.

**압축을 풀고 `Start-Web.cmd`를 더블클릭하면 개발 환경 설치부터 웹 화면 열기까지 자동으로 진행합니다.** 필요한 실행 파일과 모델은 첫 실행 때 내려받아 프로젝트 폴더에 설치합니다.

## 주요 기능

- PNG/JPEG/WebP 파일 선택, 드래그 앤 드롭, 클립보드 이미지 붙여넣기
- 기본 2배 모델, 애니메이션 선화 모델, 두 모델 결과 비교
- 작업 대기열과 진행 상태, 확대·이동이 연동되는 원본/결과 비교
- 원본을 보존한 PNG 저장 및 결과 이미지 클립보드 복사
- 8비트 RGB/RGBA PNG의 ICC 보존과 알파 채널 확대
- CUDA 메모리가 부족하면 타일 크기를 줄여 재시도

`RealESRGAN_x2plus`는 AI가 직접 2배 출력합니다. `RealESRGAN_x4plus_anime_6B`는 AI 4배 출력 후 Lanczos로 원본 대비 2배 크기로 축소합니다. 얼굴 복원과 추가 샤프닝은 적용하지 않습니다.

## 원클릭 설치와 실행

현재 지원 대상은 Windows x64와 CUDA 호환 NVIDIA GPU입니다. CPU 실행, AMD/Intel GPU 및 macOS는 지원하지 않습니다. 아래 버전 조합은 기존 RTX 4090 환경에서 검증했으며 다른 GPU에서의 호환성 검증은 별도로 필요합니다.

1. GitHub의 **Code → Download ZIP**으로 받거나 저장소를 클론합니다.
2. 로컬의 쓰기 가능한 폴더에 압축을 완전히 풉니다. 한글·공백이 있는 경로도 사용할 수 있습니다.
3. **`Start-Web.cmd`를 더블클릭**하고 설치가 끝날 때까지 기다립니다. 준비가 끝나면 브라우저가 자동으로 열립니다.

Git·Node.js·Python·uv를 미리 설치할 필요가 없습니다. 다음 항목을 프로젝트 안에 준비하고, 전역 PATH와 기존 Python 설치는 변경하지 않습니다.

| 자동 설치 항목 | 고정 버전 |
|---|---|
| Git for Windows (MinGit) | 2.56.0.2 |
| Node.js / npm | Node.js 24.18.0 및 동봉 npm |
| uv | 0.12.0 |
| Python / 가상환경 | 3.10.20 / `.venv` |
| PyTorch / torchvision | 2.7.0+cu128 / 0.22.0+cu128 |
| chaiNNer와 Python 의존성 | 0.25.1, 버전 고정 목록 사용 |
| Real-ESRGAN 모델 | x2plus, x4plus_anime_6B |

첫 설치에는 인터넷과 최소 12GB의 여유 공간이 필요합니다. CUDA PyTorch만 약 3GB이므로 다운로드에 시간이 걸릴 수 있습니다. 정상 설치 후에는 버전과 상태를 확인하여 재사용하며, 같은 설치 구성에서는 오프라인으로도 실행할 수 있습니다.

**호환 NVIDIA GPU와 그래픽 드라이버는 필요합니다.** 드라이버를 감지하지 못하거나 실제 CUDA 연산이 실패하면 원인을 표시하고 중단합니다. CUDA Toolkit은 별도로 설치하지 않습니다. Microsoft Visual C++ 런타임이 없는 PC에서는 서명 확인 후 공식 설치 프로그램을 실행하며 Windows 관리자 승인 또는 재부팅이 필요할 수 있습니다.

| 파일 | 용도 |
|---|---|
| `Start-Web.cmd` | 필요한 환경 설치·복구 → 서버 시작 → 브라우저 열기 |
| `Setup.cmd` | 개발 환경만 설치·검증 |
| `Dev-Shell.cmd` | 환경 준비 후 Git·Node·npm·uv·Python이 설정된 PowerShell 열기 |
| `Stop-Web.cmd` | 웹 서버 종료 |

개발용 터미널에서도 원클릭 런처를 사용할 수 있습니다.

```powershell
git clone https://github.com/mazelines/UpscaleCanva.git
cd UpscaleCanva
.\Start-Web.cmd
```

기본 주소는 **http://127.0.0.1:7860** 입니다. 브라우저를 열지 않으려면 `Start-Web.cmd --no-browser --no-pause`를 실행하세요. 설치만 자동화할 때는 `Setup.cmd --no-pause`를 사용합니다.

이미 실행 중이면 중복 서버를 만들지 않습니다. CMD 창을 닫아도 서버는 계속 동작합니다. 웹 사용과 선택적인 Tailscale 설정은 [웹 사용 안내](docs/WEB.md)를 참고하세요.

실패하면 `logs/setup.log`를 확인하고 같은 파일을 다시 실행하세요. 검증된 다운로드는 재사용하고 불완전한 설치는 다시 준비합니다. 기존 가상환경을 바꿔야 할 때는 `runtime/backups/`에 보존합니다. 설치 완료 표시는 모든 의존성과 실제 CUDA 연산 검사를 통과한 뒤에만 기록합니다. 강제 재검사는 개발용 터미널에서 `.\scripts\Install-Local.ps1 -Repair`로 실행할 수 있습니다.

## CLI 및 chaiNNer

```powershell
# 단일 이미지, 기본 2배 모델
.\scripts\Upscale.ps1 -InputPath 'C:\art\character.png'

# 폴더 전체, 두 모델 비교
.\scripts\Upscale.ps1 -InputPath 'C:\art\input' -OutputFolder 'C:\art\output' -Model both -Recurse

# chaiNNer 비교 워크플로 열기
.\scripts\Start-ChaiNNer.ps1 -InputPath 'C:\art\character.png'
```

CLI는 CUDA에서만 추론합니다. 16비트·다중 프레임 입력은 거부합니다. chaiNNer 기본 이미지/PNG 노드는 CLI와 ICC·알파 처리 방식이 다르므로 ICC 보존이 필요한 출력에는 웹 또는 `Upscale.ps1`을 사용하세요.

## 검증

설치가 끝난 환경에서 합성 테스트 이미지를 생성하고 실제 CUDA 추론을 검사합니다. 결과와 검사 기록은 Git에서 제외된 로컬 폴더에 저장합니다.

```powershell
# Dev-Shell.cmd로 연 개발용 터미널에서 실행
.\scripts\test-setup.ps1
.\.venv\Scripts\python.exe -X utf8 scripts\smoke_test.py
node --test web\test\server.test.mjs
```

설치 테스트는 로컬 파일로 다운로드 검증·캐시 재사용·손상 파일 복구·경로 제한을 검사하며 GPU나 외부 네트워크를 사용하지 않습니다. 웹 테스트는 이미지 검증, 접근 제한, 실제 CUDA 추론 및 다운로드, 대기열, 작업 내역 삭제를 검사합니다. 현재 실제 GPU 테스트에는 RTX 4090 확인이 포함되어 있습니다. 합성 이미지 검사는 실제 원화의 화질 검수를 대신하지 않습니다.

## 저장소 구성

| 경로 | 내용 |
|---|---|
| `web/` | Node.js 서버, 웹 화면, 웹 테스트 |
| `scripts/` | 설치, CUDA 추론, 실행 및 검증 도구 |
| `docs/gui-requirements.txt` | chaiNNer 의존성 목록 |
| `requirements*.txt`, `scripts/runtime-manifest.json` | Python 패키지 버전과 도구·모델 다운로드 URL/SHA256 |
| `models/`, `apps/`, `vendor/`, `.venv/` | 설치 시 생성되는 로컬 의존성, Git 제외 |
| `input/`, `output/`, `logs/`, `runtime/` | 사용자 이미지·결과·설정·작업 기록, Git 제외 |
| `workflows/`, `docs/*.json` | 생성된 워크플로와 검사 기록, Git 제외 |

기존 설치의 개인 설정과 이미지 파일은 각 PC에 보관합니다. 새 클론에는 포함되지 않습니다. 다른 PC에는 소스 ZIP 또는 클론을 전달하세요. 설치 폴더를 옮긴 경우 실행 시 Python 위치를 확인하고 필요한 환경과 chaiNNer 설정을 다시 준비합니다.

설치 도구의 동작과 배포 출처: [uv Python 관리](https://docs.astral.sh/uv/guides/install-python/), [Node.js 배포 파일](https://nodejs.org/dist/v24.18.0/), [Git for Windows](https://github.com/git-for-windows/git/releases/tag/v2.56.0.windows.2).

## 라이선스와 기반 프로젝트

이 저장소의 라이선스는 [MIT](LICENSE)입니다. 별도로 내려받는 모델·라이브러리·실행 파일에는 각 프로젝트의 라이선스가 적용됩니다.

- [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN)
- [chaiNNer](https://github.com/chaiNNer-org/chaiNNer)
- [Spandrel](https://github.com/chaiNNer-org/spandrel)
- [PyTorch](https://pytorch.org/)
