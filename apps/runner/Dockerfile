FROM mambaorg/micromamba:2.3.2 AS micromamba

FROM python:3.12-slim

COPY --from=micromamba /bin/micromamba /usr/local/bin/micromamba

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
ENV MAMBA_ROOT_PREFIX=/opt/conda
RUN micromamba create --yes --channel conda-forge --prefix /opt/conda/envs/research-os python=3.12 pip \
    && micromamba clean --all --yes
RUN mkdir -p /workspace/artifacts /workspace/projects \
    && chown -R runner:runner /workspace /opt/conda
WORKDIR /app
COPY apps/runner/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=runner:runner apps/runner/app ./app
COPY --chown=runner:runner apps/runner/tests ./tests
COPY --chown=runner:runner apps/api/app/reproducibility.py ./reproducibility.py
USER runner
EXPOSE 8010
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010"]
