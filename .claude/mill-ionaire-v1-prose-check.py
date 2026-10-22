#!/usr/bin/env python3
# Stop hook: checks the reply just written against Blue's formatting rules
# and sends it back for a rewrite when it breaks one.
# Plain prose only: no bullets, numbered lists, bold, headers, em or en dashes,
# no numbers outside code blocks, and none of the banned words.
import json, re, sys, os

def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    path = data.get('transcript_path')
    if not path or not os.path.exists(path):
        return 0
    entries = []
    with open(path) as f:
        for line in f:
            try:
                entries.append(json.loads(line))
            except Exception:
                pass
    # text written since the last thing the person typed
    texts = []
    for e in reversed(entries):
        if e.get('isSidechain'):
            continue
        msg = e.get('message') or {}
        role = msg.get('role') or e.get('type')
        content = msg.get('content')
        if role == 'user':
            if isinstance(content, str):
                break
            if isinstance(content, list) and any(c.get('type') == 'text' for c in content if isinstance(c, dict)):
                break
            continue
        if role == 'assistant' and isinstance(content, list):
            for c in content:
                if isinstance(c, dict) and c.get('type') == 'text':
                    texts.append(c.get('text', ''))
                if isinstance(c, dict) and c.get('type') == 'tool_use' and c.get('name') == 'SendUserMessage':
                    texts.append((c.get('input') or {}).get('message', ''))
    if not texts:
        return 0
    text = '\n'.join(reversed(texts))
    prose = re.sub(r'```.*?```', ' ', text, flags=re.S)
    prose = re.sub(r'`[^`]*`', ' ', prose)
    prose_no_urls = re.sub(r'\b[\w.-]+\.(app|com|io|org|net|wtf|dev|zone)\S*', ' ', prose)
    problems = []
    if re.search(r'^\s*[-*+•]\s+\S', prose, re.M):
        problems.append('bullet points')
    if re.search(r'^\s*\d+[.)]\s+\S', prose, re.M):
        problems.append('a numbered list')
    if re.search(r'^\s*#{1,6}\s', prose, re.M):
        problems.append('headers')
    if re.search(r'\*\*[^*]+\*\*|__[^_]+__', prose):
        problems.append('bold text')
    if re.search('[—–]', text):
        problems.append('an em or en dash')
    if re.search(r'\d', prose_no_urls):
        problems.append('numbers')
    if re.search(r'\b(honest|honestly|actually|actual)\b', prose, re.I):
        problems.append('a banned word')
    if not problems:
        return 0
    reason = ('Your reply to Blue broke his plain prose rule: it contains ' + ', '.join(problems) +
              '. Send the same reply again right now as plain prose paragraphs, with no bullets, numbered lists, '
              'bold, headers, dashes, numbers or banned words, and no apology or mention of this check.')
    print(json.dumps({'decision': 'block', 'reason': reason}))
    return 0

if __name__ == '__main__':
    sys.exit(main())
