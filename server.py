from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

app = FastAPI(title="Zombie Shooter Server")

base_dir = os.path.dirname(os.path.abspath(__file__))

app.mount("/js", StaticFiles(directory=os.path.join(base_dir, "js")), name="js")
app.mount("/assets", StaticFiles(directory=os.path.join(base_dir, "assets")), name="assets")
app.mount("/3dfps-main", StaticFiles(directory=os.path.join(base_dir, "3dfps-main")), name="3dfps-main")

@app.get("/")
async def index():
    return FileResponse(os.path.join(base_dir, "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
