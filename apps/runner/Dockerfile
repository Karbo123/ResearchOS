FROM python:3.12-slim

RUN sed -i \
      -e 's|http://deb.debian.org/debian-security|https://mirrors.ustc.edu.cn/debian-security|g' \
      -e 's|http://deb.debian.org/debian|https://mirrors.ustc.edu.cn/debian|g' \
      /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=5 -o Acquire::https::Timeout=30 update \
    && apt-get -o Acquire::Retries=5 -o Acquire::https::Timeout=30 install -y --no-install-recommends \
      git cmake latexmk texlive-latex-base texlive-latex-recommended \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10002 runner
RUN git config --system --add safe.directory '*'
WORKDIR /app
COPY apps/runner/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY apps/runner/app ./app
COPY apps/runner/tests ./tests
COPY apps/api/app/reproducibility.py ./reproducibility.py
RUN mkdir -p /workspace/artifacts /workspace/projects && chown -R runner:runner /app /workspace
USER runner
EXPOSE 8010
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010"]
