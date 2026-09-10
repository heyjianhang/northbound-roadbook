'use client';
import { useState } from 'react';
import { Check, Download, Share } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Notice } from '@/features/accounts/shared';
import { usePwa } from './register';

export function InstallCard() {
  const { installed, canInstall, ios, install } = usePwa();
  const [guide, setGuide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function startInstall() {
    setError('');
    setNotice('');
    if (ios || !canInstall) {
      setGuide(true);
      return;
    }
    setBusy(true);
    try {
      const outcome = await install();
      if (outcome === 'accepted')
        setNotice('已确认安装，请在主屏幕或应用列表中查看。');
      else {
        setGuide(true);
        if (outcome === 'dismissed')
          setNotice('已取消安装，也可以稍后从浏览器菜单添加。');
      }
    } catch {
      setError('未能打开安装提示，请按下面的步骤添加。');
      setGuide(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>安装北行路书</h2>
        </CardTitle>
        <CardDescription>
          {installed
            ? '已从主屏幕打开，可直接使用。'
            : '添加到主屏幕，出发时一键打开。'}
        </CardDescription>
      </CardHeader>
      {(guide || error || notice) && !installed && (
        <CardContent className="flex flex-col gap-3">
          <Notice message={error} error />
          <Notice message={notice} />
          {guide &&
            (ios ? (
              <ol className="list-decimal pl-5 flex flex-col gap-2">
                <li>在 Safari 中打开北行路书。</li>
                <li>
                  点浏览器的
                  <Share className="inline size-4 mx-1" aria-label="共享" />
                  共享按钮；部分版本需先点「更多」。
                </li>
                <li>
                  选择「添加到主屏幕」，再点「添加」。若显示「作为网页 App
                  打开」，请保持开启。
                </li>
              </ol>
            ) : (
              <ol className="list-decimal pl-5 flex flex-col gap-2">
                <li>在 Chrome 或 Edge 中打开北行路书。</li>
                <li>点浏览器菜单，选择「安装应用」或「添加到主屏幕」。</li>
                <li>
                  确认添加。若没有安装选项，请更新浏览器；微信内可先选择「在浏览器打开」。
                </li>
              </ol>
            ))}
        </CardContent>
      )}
      <CardFooter>
        <Button
          className="w-full sm:w-auto"
          disabled={installed || busy}
          onClick={() => void startInstall()}
        >
          {busy ? (
            <Spinner data-icon="inline-start" />
          ) : installed ? (
            <Check data-icon="inline-start" />
          ) : (
            <Download data-icon="inline-start" />
          )}
          {installed
            ? '已安装'
            : busy
              ? '等待确认…'
              : ios
                ? '添加到主屏幕'
                : '安装到设备'}
        </Button>
      </CardFooter>
    </Card>
  );
}
