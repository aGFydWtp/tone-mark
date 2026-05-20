# Ubuntu base so the official Audiveris .deb (and its bundled JRE) installs cleanly.
FROM --platform=linux/amd64 ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive
ARG AUDIVERIS_VERSION=5.10.2
ARG TESSDATA_VERSION=4.1.0

# Runtime deps (Python, Tesseract OCR, fonts) plus build deps for awslambdaric.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-dev \
      curl ca-certificates unzip \
      fontconfig \
      tesseract-ocr tesseract-ocr-eng \
      g++ make cmake autoconf libtool libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Audiveris requests Tesseract's legacy OCR engine, but Ubuntu's tesseract-ocr-eng
# ships LSTM-only data. Replace it with the combined legacy+LSTM traineddata so
# text recognition (titles, lyrics, directions) works.
RUN curl -fsSL -o /usr/share/tesseract-ocr/5/tessdata/eng.traineddata \
      "https://github.com/tesseract-ocr/tessdata/raw/${TESSDATA_VERSION}/eng.traineddata"

# AWS Lambda Runtime Interface Client — required because this is a custom base image.
RUN pip3 install --break-system-packages --no-cache-dir awslambdaric boto3

# Audiveris official Ubuntu installer. The .deb bundles its own JRE; apt resolves
# the remaining Debian dependencies. Its postinstall registers a desktop menu
# entry, which fails in a headless container — that cosmetic failure is tolerated
# and the install is confirmed by checking the launcher exists.
RUN curl -fsSL -o /tmp/audiveris.deb \
      "https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/Audiveris-${AUDIVERIS_VERSION}-ubuntu24.04-x86_64.deb" \
    && apt-get update \
    && { apt-get install -y --no-install-recommends /tmp/audiveris.deb || true; } \
    && test -x /opt/audiveris/bin/Audiveris \
    && rm /tmp/audiveris.deb \
    && rm -rf /var/lib/apt/lists/*

# Lambda only allows writes under /tmp; point Audiveris config/cache there.
ENV HOME=/tmp
ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata
ENV PATH="/opt/audiveris/bin:${PATH}"

WORKDIR /var/task
COPY handler.py /var/task/handler.py

ENTRYPOINT ["python3", "-m", "awslambdaric"]
CMD ["handler.handler"]
