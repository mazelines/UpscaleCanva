# UpscaleCanva

Windows에서 실행하는 로컬 AI 이미지 업스케일 도구입니다. 현재 웹 화면 이름은 **ARION Upscale Studio**이며, Real-ESRGAN 모델을 사용해 원본의 가로·세로를 각각 2배로 확대합니다.

이 저장소는 기존 로컬 프로젝트의 소스와 실행 스크립트를 관리합니다. **아직 런타임이 동봉된 원클릭 배포본은 아닙니다.** 최초 설치에는 아래 개발 환경이 필요하며, 자동 설치·실행 패키지는 후속 작업입니다.

## 주요 기능

- PNG/JPEG/WebP 파일 선택, 드래그 앤 드롭, 클립보드 이미지 붙여넣기
- 기본 2배 모델, 애니메이션 선화 모델, 두 모델 결과 비교
- 작업 대기열과 진행 상태, 확대·이동이 연동되는 원본/결과 비교
- 원본을 보존한 PNG 저장 및 결과 이미지 클립보드 복사
- 8비트 RGB/RGBA PNG의 ICC 보존과 알파 채널 확대
- CUDA 메모리가 부족하면 타일 크기를 줄여 재시도

`RealESRGAN_x2plus`는 AI가 직접 2배 출력합니다. `RealESRGAN_x4plus_anime_6B`는 AI 4배 출력 후 Lanczos로 원본 대비 2배 크기로 축소합니다. 얼굴 복원과 추가 샤프닝은 적용하지 않습니다.

## 개발 환경 설치

현재 지원 대상은 Windows x64와 CUDA 호환 NVIDIA GPU입니다. CPU 실행, AMD/Intel GPU 및 macOS는 지원하지 않습니다. 아래 버전 조합은 기존 RTX 4090 환경에서 검증했으며 다른 GPU에서의 호환성 검증은 별도로 필요합니다.

- Git, Node.js 24 이상, `uv`를 설치하고 PATH에서 실행할 수 있어야 합니다.
- GPU에 호환되는 NVIDIA 드라이버가 필요합니다.
- 설치 스크립트가 Python 3.10.20, PyTorch 2.7.0+cu128, torchvision 0.22.0+cu128, 모델 두 개 및 chaiNNer 0.25.1을 준비합니다.
- 현재 설치·시작 검사는 chaiNNer 구성에도 의존합니다. CUDA 런타임은 PyTorch 패키지에 포함되며 별도 CUDA Toolkit 설치는 요구하지 않습니다.

```powershell
git clone https://github.com/mazelines/UpscaleCanva.git
cd UpscaleCanva
.\scripts\Install-Local.ps1
.\Start-Web.cmd
```

설치가 끝난 뒤에는 `Start-Web.cmd`를 더블클릭하여 서버를 시작할 수 있습니다. 서버 준비 후 브라우저에서 **http://127.0.0.1:7860** 을 여세요. 현재 런처는 브라우저를 자동으로 열지 않습니다.

이미 실행 중이면 중복 서버를 만들지 않습니다. CMD 창을 닫아도 서버는 계속 동작하며, 종료하려면 `.\scripts\Stop-Web.ps1`을 실행하세요. 웹 사용과 선택적인 Tailscale 설정은 [웹 사용 안내](docs/WEB.md)를 참고하세요.

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
.\.venv\Scripts\python.exe -X utf8 scripts\smoke_test.py
node --test web\test\server.test.mjs
```

웹 테스트는 이미지 검증, 접근 제한, 실제 CUDA 추론 및 다운로드, 대기열, 작업 내역 삭제를 검사합니다. 현재 실제 GPU 테스트에는 RTX 4090 확인이 포함되어 있습니다. 합성 이미지 검사는 실제 원화의 화질 검수를 대신하지 않습니다.

## 저장소 구성

| 경로 | 내용 |
|---|---|
| `web/` | Node.js 서버, 웹 화면, 웹 테스트 |
| `scripts/` | 설치, CUDA 추론, 실행 및 검증 도구 |
| `docs/gui-requirements.txt` | chaiNNer 의존성 목록 |
| `models/`, `apps/`, `vendor/`, `.venv/` | 설치 시 생성되는 로컬 의존성, Git 제외 |
| `input/`, `output/`, `logs/`, `runtime/` | 사용자 이미지·결과·설정·작업 기록, Git 제외 |
| `workflows/`, `docs/*.json` | 생성된 워크플로와 검사 기록, Git 제외 |

기존 설치의 개인 설정과 이미지 파일은 각 PC에 보관합니다. 새 클론에는 포함되지 않습니다. Python 가상환경은 설치 위치에 맞춰 생성해야 하므로 다른 PC의 `.venv`를 복사해 사용하지 마세요.

## 라이선스와 기반 프로젝트

이 저장소의 라이선스는 [MIT](LICENSE)입니다. 별도로 내려받는 모델·라이브러리·실행 파일에는 각 프로젝트의 라이선스가 적용됩니다.

- [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN)
- [chaiNNer](https://github.com/chaiNNer-org/chaiNNer)
- [Spandrel](https://github.com/chaiNNer-org/spandrel)
- [PyTorch](https://pytorch.org/)
