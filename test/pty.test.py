#!/usr/bin/env python3
"""Runs the real retro-zip command in a pseudo-terminal and drives it with keys."""
import os, pty, select, struct, fcntl, termios, time, sys, signal

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def run(args, keys, sig=None):
    pid, fd = pty.fork()
    if pid == 0:
        os.environ['RETRO_ZIP_HOME'] = '/nonexistent/retro-zip-test'
        os.execvp('node', ['node', os.path.join(ROOT, 'bin/retro-zip.mjs')] + args)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))
    out = b''
    def drain(t):
        nonlocal out
        end = time.time() + t
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], 0.05)
            if r:
                try:
                    out += os.read(fd, 65536)
                except OSError:
                    return
    drain(0.6)
    marks = []
    for k in keys:
        n = len(out)
        os.write(fd, k)
        drain(0.5)
        marks.append(out[n:])
    if sig:
        os.kill(pid, sig)
        drain(0.5)
    deadline = time.time() + 3
    status = None
    while time.time() < deadline:
        p, st = os.waitpid(pid, os.WNOHANG)
        if p:
            status = st
            break
        drain(0.1)
    if status is None:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
    return out, marks, status

fails = 0
def check(name, cond):
    global fails
    print(('ok   ' if cond else 'FAIL ') + name)
    fails += 0 if cond else 1

out, marks, st = run([], [b'\x1b[B', b' ', b'\x1b[A', b'\x1b', b'\x1b'])
check('menu draws in the alternate screen', b'\x1b[?1049h' in out and b'R E T R O' in out)
check('down arrow moves the selection', b'> Snake' in out or b'>' in marks[0])
check('space starts the chosen game', b'SNAKE' in out)
check('esc twice quits cleanly', st == 0)
check('terminal restored on quit', out.rstrip().endswith(b'\x1b[?1049l\x1b[?25h\x1b[0m'))

out, marks, st = run(['play', 'rocks'], [b' ', b'\x1b[C'])
check('play rocks starts directly', b'ROCKS' in out)
out2, _, st2 = run(['play', 'rocks'], [b'\x03'])
check('ctrl-c quits and restores', st2 == 0 and b'\x1b[?25h' in out2)
out3, _, st3 = run(['play', 'snake'], [], sig=signal.SIGTERM)
check('SIGTERM restores the terminal', b'\x1b[?1049l' in out3)
sys.exit(1 if fails else 0)
