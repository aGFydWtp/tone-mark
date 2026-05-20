import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from glob import glob

import boto3


AUDIVERIS_BIN = os.environ.get("AUDIVERIS_BIN", "/opt/audiveris/bin/Audiveris")
AUDIVERIS_TIMEOUT_SECONDS = int(os.environ.get("AUDIVERIS_TIMEOUT_SECONDS", "780"))
MUSICXML_CONTENT_TYPE = "application/vnd.recordare.musicxml+xml; charset=utf-8"
# score_id is server-generated as score_<14 digits>_<12 hex>; reject anything else
# before it reaches filesystem paths or S3 keys.
SCORE_ID_PATTERN = re.compile(r"score_\d{14}_[0-9a-f]{12}")

_s3_client = None
_jobs_table = None


def handler(event, context):
    processed = 0

    for record in event.get("Records", []):
        body = json.loads(record["body"])
        job_type = body.get("job_type")
        if job_type == "omr":
            process_omr_record(body)
            processed += 1
        else:
            print(f"skipping record with unsupported job_type: {job_type!r}")

    print(json.dumps({"message": "omr worker completed", "processed": processed}))
    return {"ok": True, "processed": processed}


def process_omr_record(body):
    score_id = body.get("score_id")
    original_key = body.get("original_key")
    if not score_id or not original_key:
        raise ValueError("score_id and original_key are required")
    if not SCORE_ID_PATTERN.fullmatch(score_id):
        raise ValueError(f"invalid score_id format: {score_id!r}")

    ddb_key = {"pk": f"SCORE#{score_id}", "sk": "META"}
    work_dir = os.path.join("/tmp", score_id)

    try:
        set_status(ddb_key, "processing_omr")

        os.makedirs(work_dir, exist_ok=True)
        input_path = os.path.join(work_dir, f"input{extension_of(original_key)}")
        s3_client().download_file(bucket_name(), original_key, input_path)

        musicxml = convert_to_musicxml(input_path, work_dir)

        musicxml_key = f"scores/{score_id}/result.musicxml"
        s3_client().put_object(
            Bucket=bucket_name(),
            Key=musicxml_key,
            Body=musicxml.encode("utf-8"),
            ContentType=MUSICXML_CONTENT_TYPE,
        )

        jobs_table().update_item(
            Key=ddb_key,
            UpdateExpression=(
                "SET #status = :status, musicxml_key = :musicxml_key, "
                "updated_at = :updated_at REMOVE error_message"
            ),
            ConditionExpression="attribute_exists(pk)",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":status": "needs_review",
                ":musicxml_key": musicxml_key,
                ":updated_at": iso_now(),
            },
        )
        print(f"omr completed for {score_id}: {musicxml_key}")
    except Exception as error:
        try:
            mark_failed(ddb_key, error)
        except Exception as mark_error:
            print(f"failed to record failure for {score_id}: {mark_error}")
        raise
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def convert_to_musicxml(input_path, work_dir):
    """Run Audiveris OMR on input_path and return the MusicXML document text."""
    export_dir = os.path.join(work_dir, "audiveris-out")
    os.makedirs(export_dir, exist_ok=True)

    result = subprocess.run(
        [AUDIVERIS_BIN, "-batch", "-export", "-output", export_dir, input_path],
        capture_output=True,
        text=True,
        timeout=AUDIVERIS_TIMEOUT_SECONDS,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Audiveris exited with code {result.returncode}: "
            f"{result.stderr.strip()[-2000:]}"
        )

    mxl_files = sorted(glob(os.path.join(export_dir, "**", "*.mxl"), recursive=True))
    if not mxl_files:
        raise RuntimeError("Audiveris produced no MusicXML (.mxl) output")

    # A multi-movement book also yields per-movement files; prefer the book-level export.
    book_level = [path for path in mxl_files if ".mvt" not in os.path.basename(path)]
    return read_mxl((book_level or mxl_files)[0])


def read_mxl(mxl_path):
    """Extract the MusicXML document text from a compressed .mxl (zip) container."""
    with zipfile.ZipFile(mxl_path) as archive:
        score_name = rootfile_name(archive)
        if score_name is None:
            score_name = next(
                (
                    name
                    for name in archive.namelist()
                    if name.lower().endswith((".musicxml", ".xml"))
                    and not name.startswith("META-INF/")
                ),
                None,
            )
        if score_name is None:
            raise RuntimeError(f"no score file found inside {os.path.basename(mxl_path)}")
        return archive.read(score_name).decode("utf-8")


def rootfile_name(archive):
    """Read the root score path from the .mxl META-INF/container.xml manifest."""
    try:
        manifest = archive.read("META-INF/container.xml")
    except KeyError:
        return None
    rootfile = ET.fromstring(manifest).find(".//{*}rootfile")
    return rootfile.get("full-path") if rootfile is not None else None


def set_status(ddb_key, status):
    jobs_table().update_item(
        Key=ddb_key,
        UpdateExpression="SET #status = :status, updated_at = :updated_at",
        ConditionExpression="attribute_exists(pk)",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={":status": status, ":updated_at": iso_now()},
    )


def mark_failed(ddb_key, error):
    jobs_table().update_item(
        Key=ddb_key,
        UpdateExpression=(
            "SET #status = :status, error_message = :error_message, "
            "updated_at = :updated_at"
        ),
        ConditionExpression="attribute_exists(pk)",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":status": "failed",
            ":error_message": str(error)[:1000],
            ":updated_at": iso_now(),
        },
    )


def extension_of(key):
    ext = os.path.splitext(key)[1].lower()
    return ext if ext else ".pdf"


def iso_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def s3_client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3")
    return _s3_client


def jobs_table():
    global _jobs_table
    if _jobs_table is None:
        _jobs_table = boto3.resource("dynamodb").Table(os.environ["SCORE_JOBS_TABLE_NAME"])
    return _jobs_table


def bucket_name():
    return os.environ["SCORE_BUCKET_NAME"]


def _main(argv):
    """Local verification entry point: run Audiveris OMR without any AWS calls."""
    if not argv:
        print("usage: python handler.py <input-file> [output.musicxml]", file=sys.stderr)
        return 2

    input_path = argv[0]
    output_path = argv[1] if len(argv) > 1 else None

    with tempfile.TemporaryDirectory() as work_dir:
        musicxml = convert_to_musicxml(input_path, work_dir)

    pitched_notes = musicxml.count("<pitch>")
    if output_path:
        with open(output_path, "w", encoding="utf-8") as out:
            out.write(musicxml)
        print(f"wrote {output_path} ({len(musicxml)} bytes, {pitched_notes} pitched notes)")
    else:
        sys.stdout.write(musicxml)
        print(f"\n[{len(musicxml)} bytes, {pitched_notes} pitched notes]", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
