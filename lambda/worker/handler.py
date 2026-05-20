import json
import os


def handler(event, context):
    print(
        json.dumps(
            {
                "message": "tone-mark worker placeholder",
                "record_count": len(event.get("Records", [])),
                "score_bucket_name": os.environ.get("SCORE_BUCKET_NAME"),
                "aws_request_id": getattr(context, "aws_request_id", None),
            }
        )
    )

    return {"ok": True}
