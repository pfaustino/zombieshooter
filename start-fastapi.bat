@echo off
echo Installing dependencies...
pip install fastapi uvicorn
echo.
echo Starting Zombie Shooter server on http://localhost:8080
echo Press Ctrl+C to stop
echo.
python server.py
