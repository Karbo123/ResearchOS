FROM python:3.12-slim

RUN sed -i \
      -e 's|http://deb.debian.org/debian-security|https://mirrors.ustc.edu.cn/debian-security|g' \
      -e 's|http://deb.debian.org/debian|https://mirrors.ustc.edu.cn/debian|g' \
      /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=5 -o Acquire::https::Timeout=30 update \
    && apt-get -o Acquire::Retries=5 -o Acquire::https::Timeout=30 install -y --no-install-recommends \
      git ca-certificates \
      tesseract-ocr tesseract-ocr-chi-sim \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 app
WORKDIR /workspace/apps/api
ENV PYTHONPATH=/workspace:/workspace/apps/api
COPY apps/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY apps/api/app ./app
COPY apps/api/static ./static
COPY apps/api/tests ./tests
COPY alembic.ini /workspace/alembic.ini
COPY migrations /workspace/migrations
COPY schemas /workspace/schemas
COPY scripts/idea_case_loader.py /workspace/scripts/idea_case_loader.py
COPY scripts/provision_db_roles.py /workspace/scripts/provision_db_roles.py
COPY tests/idea-cases /workspace/tests/idea-cases
RUN chown -R app:app /workspace
USER app
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
