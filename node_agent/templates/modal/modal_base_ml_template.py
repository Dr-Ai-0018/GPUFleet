import modal
import json


# GPUFleet phase-1 broad-coverage base image for Modal runner workloads.
# Keep this definition as stable as possible to maximize image cache reuse.
image = (
    modal.Image.debian_slim()
    .apt_install(
        "git",
        "wget",
        "curl",
        "unzip",
        "libgl1",
        "libglib2.0-0",
        "ffmpeg",
        "build-essential",
    )
    .uv_pip_install(
        "numpy",
        "pandas",
        "scipy",
        "scikit-learn",
        "matplotlib",
        "tqdm",
        "requests",
        "pyyaml",
        "pillow",
        "opencv-python-headless",
        "scikit-image",
        "albumentations",
        "timm",
        "torch",
        "torchvision",
        "rasterio",
        "shapely",
        "xarray",
    )
)


volume = modal.Volume.from_name("gpufleet-data", create_if_missing=True)
app = modal.App("gpufleet-modal-base-ml", image=image)


@app.function(gpu="L4", cpu=8.0, volumes={"/data": volume}, timeout=60 * 60 * 4)
def health_check():
    import json
    import os
    import platform

    try:
        import torch

        torch_version = str(torch.__version__)
        cuda_available = torch.cuda.is_available()
    except Exception as exc:
        torch_version = None
        cuda_available = False
        error_text = f"{type(exc).__name__}: {exc}"
    else:
        error_text = None

    return {
        "ok": True,
        "platform": platform.platform(),
        "cwd": os.getcwd(),
        "torch_version": torch_version,
        "cuda_available": cuda_available,
        "error": error_text,
    }


@app.local_entrypoint()
def main():
    result = health_check.remote()
    print(json.dumps(result, ensure_ascii=False, indent=2))
