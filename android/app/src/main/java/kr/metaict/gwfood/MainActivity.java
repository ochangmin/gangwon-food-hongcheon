package kr.metaict.gwfood;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebResourceError;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 먹거리 이음 기사 앱
 * - 급식.shop 기사 화면을 앱으로 연다 (로그인·운행·식자재 검수·위치 보고)
 * - 휴대폰이 차량 단말 역할: 블루투스 온습도계(환경센서 0x181A / 샤오미 LYWSD03)에 연결해
 *   측정값을 웹 화면(window.__ble)으로 넘긴다 → 웹 화면이 관제로 전송
 */
public class MainActivity extends Activity {
    static final String HOME = "https://www.xn--kj0b080b.shop/?app=android#driver";
    static final String HOST = "www.xn--kj0b080b.shop";
    static final int REQ_LOC = 11, REQ_BT = 12, REQ_FILE = 13;

    static final UUID ESS = uuid16(0x181A), TEMP = uuid16(0x2A6E), HUM = uuid16(0x2A6F);
    static final UUID BAT_S = uuid16(0x180F), BAT_C = uuid16(0x2A19);
    static final UUID CCCD = uuid16(0x2902);
    static final UUID MI_S = UUID.fromString("ebe0ccb0-7a0a-4b0c-8a1a-6ff2997da3a6");
    static final UUID MI_C = UUID.fromString("ebe0ccc1-7a0a-4b0c-8a1a-6ff2997da3a6");

    WebView web;
    FrameLayout root; View splash, offline; ProgressBar bar;
    ValueCallback<Uri[]> fileCb;
    long backAt = 0;
    final Handler ui = new Handler(Looper.getMainLooper());
    GeolocationPermissions.Callback geoCb; String geoOrigin;
    BluetoothAdapter bt; BluetoothLeScanner scanner; boolean scanning;
    final Map<String, BluetoothDevice> found = new LinkedHashMap<>();
    final Map<String, String> foundName = new LinkedHashMap<>();
    final Map<String, BluetoothGatt> gatts = new LinkedHashMap<>();

    static UUID uuid16(int v){return UUID.fromString(String.format("0000%04x-0000-1000-8000-00805f9b34fb", v));}

    @SuppressLint("SetJavaScriptEnabled")
    @Override protected void onCreate(Bundle b){
        super.onCreate(b);
        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);
        root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        // 상단 로딩 막대
        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);bar.setVisibility(View.GONE);
        root.addView(bar, new FrameLayout.LayoutParams(-1, dp(4), Gravity.TOP));
        // 시작 화면
        LinearLayout sp = new LinearLayout(this);sp.setOrientation(LinearLayout.VERTICAL);sp.setGravity(Gravity.CENTER);sp.setBackgroundColor(Color.parseColor("#12283F"));
        ImageView ic = new ImageView(this);ic.setImageResource(R.mipmap.ic_launcher);sp.addView(ic, new LinearLayout.LayoutParams(dp(96), dp(96)));
        TextView t1 = new TextView(this);t1.setText("먹거리 이음 기사");t1.setTextColor(Color.WHITE);t1.setTextSize(24);t1.setPadding(0, dp(16), 0, dp(4));t1.setGravity(Gravity.CENTER);sp.addView(t1);
        TextView t2 = new TextView(this);t2.setText("홍천 학교급식 배송");t2.setTextColor(Color.parseColor("#BFD0DC"));t2.setTextSize(16);t2.setGravity(Gravity.CENTER);sp.addView(t2);
        splash = sp;root.addView(sp, new FrameLayout.LayoutParams(-1, -1));
        // 인터넷 끊김 화면
        LinearLayout off = new LinearLayout(this);off.setOrientation(LinearLayout.VERTICAL);off.setGravity(Gravity.CENTER);off.setBackgroundColor(Color.WHITE);off.setPadding(dp(32), 0, dp(32), 0);
        TextView o1 = new TextView(this);o1.setText("인터넷에 연결할 수 없습니다");o1.setTextSize(22);o1.setTextColor(Color.parseColor("#12283F"));o1.setGravity(Gravity.CENTER);off.addView(o1);
        TextView o2 = new TextView(this);o2.setText("데이터 또는 와이파이 연결을 확인한 뒤 다시 시도하세요.");o2.setTextSize(16);o2.setTextColor(Color.parseColor("#33404C"));o2.setGravity(Gravity.CENTER);o2.setPadding(0, dp(10), 0, dp(20));off.addView(o2);
        Button rb = new Button(this);rb.setText("다시 시도");rb.setTextSize(18);rb.setOnClickListener(v -> {offline.setVisibility(View.GONE);web.reload();});off.addView(rb);
        off.setVisibility(View.GONE);offline = off;root.addView(off, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setUserAgentString(s.getUserAgentString() + " GwFoodDriver/1.2");
        // 글씨 크기: 기본 130%, 기사 화면 '내 정보'에서 조절한 값이 있으면 그 값
        s.setTextZoom(getSharedPreferences("gw", MODE_PRIVATE).getInt("zoom", 130));
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        web.addJavascriptInterface(new Bridge(), "AndroidBLE");
        web.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView v, String url){if (splash.getVisibility() == View.VISIBLE) ui.postDelayed(() -> splash.setVisibility(View.GONE), 400);}
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e){
                if (r.isForMainFrame()){offline.setVisibility(View.VISIBLE);splash.setVisibility(View.GONE);}
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r){
                Uri u = r.getUrl();
                if (HOST.equals(u.getHost())) return false;
                // 카카오맵 등 바깥 링크는 휴대폰 브라우저·지도 앱으로
                try{startActivity(new Intent(Intent.ACTION_VIEW, u));}catch(Exception e){}
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public void onProgressChanged(WebView v, int p){bar.setProgress(p);bar.setVisibility(p < 100 ? View.VISIBLE : View.GONE);}
            // 검수 사진 등 파일 첨부
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params){
                if (fileCb != null) fileCb.onReceiveValue(null);fileCb = cb;
                try{startActivityForResult(params.createIntent(), REQ_FILE);}catch(Exception e){fileCb = null;return false;}
                return true;
            }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb){
                if (hasLoc()){cb.invoke(origin, true, false);return;}
                geoCb = cb;geoOrigin = origin;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOC);
            }
        });
        if (b != null) web.restoreState(b); else web.loadUrl(HOME);
    }

    @Override protected void onSaveInstanceState(Bundle o){super.onSaveInstanceState(o);web.saveState(o);}
    @Override public void onBackPressed(){
        if (web.canGoBack()){web.goBack();return;}
        long now = System.currentTimeMillis();
        if (now - backAt < 2000){super.onBackPressed();return;}
        backAt = now;Toast.makeText(this, "한 번 더 누르면 앱을 닫습니다", Toast.LENGTH_SHORT).show();
    }
    @Override protected void onActivityResult(int req, int res, Intent data){
        super.onActivityResult(req, res, data);
        if (req == REQ_FILE && fileCb != null){fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));fileCb = null;}
    }
    int dp(int v){return Math.round(v * getResources().getDisplayMetrics().density);}
    @Override protected void onDestroy(){
        for (BluetoothGatt g : gatts.values()) try{g.close();}catch(SecurityException e){}
        super.onDestroy();
    }

    boolean hasLoc(){return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;}
    boolean hasBt(){
        if (Build.VERSION.SDK_INT >= 31) return checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
        return hasLoc();
    }

    @Override public void onRequestPermissionsResult(int code, String[] p, int[] r){
        boolean ok = r.length > 0 && r[0] == PackageManager.PERMISSION_GRANTED;
        if (code == REQ_LOC && geoCb != null){geoCb.invoke(geoOrigin, ok, false);geoCb = null;}
        if (code == REQ_BT){if (ok) startScan(); else emit("{\"type\":\"error\",\"msg\":\"블루투스 권한이 거부되었습니다. 설정에서 허용해 주세요.\"}");}
    }

    // ── 웹 화면으로 이벤트 전달 ──
    void emit(String json){ui.post(() -> web.evaluateJavascript("window.__ble&&window.__ble(" + JSONObject.quote(json) + ")", null));}

    class Bridge {
        @JavascriptInterface public boolean available(){
            BluetoothManager m = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
            return m != null && m.getAdapter() != null;
        }
        @JavascriptInterface public void pick(){ui.post(MainActivity.this::beginPick);}
        @JavascriptInterface public void disconnect(String id){ui.post(() -> {BluetoothGatt g = gatts.remove(id);if (g != null) try{g.disconnect();g.close();}catch(SecurityException e){}});}
        @JavascriptInterface public String version(){return "1.2";}
        @JavascriptInterface public int versionCode(){try{android.content.pm.PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);return Build.VERSION.SDK_INT >= 28 ? (int) pi.getLongVersionCode() : pi.versionCode;}catch(Exception e){return 0;}}
        // 운행 중에는 화면이 꺼지지 않게
        @JavascriptInterface public void keepScreenOn(boolean on){ui.post(() -> {if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);});}
        @JavascriptInterface public void openUrl(String url){ui.post(() -> {try{startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));}catch(Exception e){}});}
        @JavascriptInterface public void reload(){ui.post(() -> web.reload());}
        @JavascriptInterface public int getTextZoom(){return web.getSettings().getTextZoom();}
        @JavascriptInterface public void setTextZoom(int z){
            final int v = Math.max(100, Math.min(200, z));
            getSharedPreferences("gw", MODE_PRIVATE).edit().putInt("zoom", v).apply();
            ui.post(() -> web.getSettings().setTextZoom(v));
        }
    }

    void beginPick(){
        BluetoothManager m = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
        bt = m == null ? null : m.getAdapter();
        if (bt == null){emit("{\"type\":\"error\",\"msg\":\"이 휴대폰은 블루투스를 지원하지 않습니다.\"}");return;}
        if (!bt.isEnabled()){emit("{\"type\":\"error\",\"msg\":\"블루투스를 켜 주세요.\"}");return;}
        if (!hasBt()){
            if (Build.VERSION.SDK_INT >= 31) requestPermissions(new String[]{Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT}, REQ_BT);
            else requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION}, REQ_BT);
            return;
        }
        startScan();
    }

    final ScanCallback scanCb = new ScanCallback(){
        @Override public void onScanResult(int type, ScanResult r){
            BluetoothDevice d = r.getDevice();ScanRecord rec = r.getScanRecord();
            String name = rec != null && rec.getDeviceName() != null ? rec.getDeviceName() : "";
            boolean ess = false;
            if (rec != null && rec.getServiceUuids() != null) for (ParcelUuid pu : rec.getServiceUuids()) if (pu.getUuid().equals(ESS)) ess = true;
            if (rec != null && rec.getServiceData() != null && rec.getServiceData().containsKey(new ParcelUuid(ESS))) ess = true;
            boolean named = name.startsWith("LYWSD") || name.startsWith("ATC_") || name.startsWith("MJ_HT") || name.startsWith("TH") || name.toLowerCase().contains("thermo") || name.toLowerCase().contains("hygro");
            if (!ess && !named) return;
            String id = d.getAddress();
            if (!found.containsKey(id)){found.put(id, d);foundName.put(id, (name.isEmpty() ? "온습도계" : name) + "  (" + id + ", " + r.getRssi() + "dBm)");}
        }
    };

    @SuppressLint("MissingPermission")
    void startScan(){
        try{
            scanner = bt.getBluetoothLeScanner();if (scanner == null){emit("{\"type\":\"error\",\"msg\":\"블루투스 검색을 시작할 수 없습니다.\"}");return;}
            found.clear();foundName.clear();scanning = true;
            scanner.startScan(scanCb);
            emit("{\"type\":\"scanning\"}");
            ui.postDelayed(this::stopScanAndChoose, 6000);
        }catch(SecurityException e){emit("{\"type\":\"error\",\"msg\":\"블루투스 권한이 필요합니다.\"}");}
    }

    @SuppressLint("MissingPermission")
    void stopScanAndChoose(){
        if (scanning){try{scanner.stopScan(scanCb);}catch(SecurityException e){}scanning = false;}
        if (found.isEmpty()){emit("{\"type\":\"error\",\"msg\":\"주변에서 블루투스 온습도계를 찾지 못했습니다. 센서를 가까이 두고 다시 시도하세요.\"}");return;}
        final List<String> ids = new ArrayList<>(found.keySet());
        String[] labels = new String[ids.size()];for (int i = 0; i < ids.size(); i++) labels[i] = foundName.get(ids.get(i));
        new AlertDialog.Builder(this).setTitle("연결할 온습도계 선택").setItems(labels, (dlg, which) -> connect(found.get(ids.get(which))))
            .setNegativeButton("취소", null).show();
    }

    @SuppressLint("MissingPermission")
    void connect(BluetoothDevice d){
        final String id = d.getAddress();final String name = d.getName() != null ? d.getName() : "온습도계";
        emit(json("connecting", id, name));
        BluetoothGatt g = d.connectGatt(this, false, new BluetoothGattCallback(){
            final List<BluetoothGattCharacteristic> pending = new ArrayList<>();
            Double lastT = null; Integer lastH = null; Integer batt = null;

            @Override public void onConnectionStateChange(BluetoothGatt gatt, int status, int state){
                try{
                    if (state == BluetoothProfile.STATE_CONNECTED){emit(json("connected", id, name));gatt.discoverServices();}
                    else if (state == BluetoothProfile.STATE_DISCONNECTED){emit(json("disconnected", id, name));gatt.close();gatts.remove(id);}
                }catch(SecurityException e){}
            }
            @Override public void onServicesDiscovered(BluetoothGatt gatt, int status){
                BluetoothGattService ess = gatt.getService(ESS), mi = gatt.getService(MI_S), bat = gatt.getService(BAT_S);
                if (ess != null){addIf(ess.getCharacteristic(TEMP));addIf(ess.getCharacteristic(HUM));}
                if (mi != null) addIf(mi.getCharacteristic(MI_C));
                if (bat != null) addIf(bat.getCharacteristic(BAT_C));
                if (pending.isEmpty()){emit("{\"type\":\"error\",\"msg\":\"온습도 값을 읽을 수 없는 기기입니다.\"}");return;}
                next(gatt);
            }
            void addIf(BluetoothGattCharacteristic c){if (c != null) pending.add(c);}
            // 한 번에 하나씩: 읽기 → 알림 켜기
            @SuppressLint("MissingPermission")
            void next(BluetoothGatt gatt){
                if (pending.isEmpty()) return;
                BluetoothGattCharacteristic c = pending.remove(0);
                try{
                    if ((c.getProperties() & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0){
                        gatt.setCharacteristicNotification(c, true);
                        BluetoothGattDescriptor dsc = c.getDescriptor(CCCD);
                        if (dsc != null){dsc.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);gatt.writeDescriptor(dsc);return;}
                    }
                    if ((c.getProperties() & BluetoothGattCharacteristic.PROPERTY_READ) != 0){gatt.readCharacteristic(c);return;}
                }catch(SecurityException e){}
                next(gatt);
            }
            @Override public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor d, int status){
                BluetoothGattCharacteristic c = d.getCharacteristic();
                try{if ((c.getProperties() & BluetoothGattCharacteristic.PROPERTY_READ) != 0){gatt.readCharacteristic(c);return;}}catch(SecurityException e){}
                next(gatt);
            }
            @Override public void onCharacteristicRead(BluetoothGatt gatt, BluetoothGattCharacteristic c, int status){handle(c, c.getValue());next(gatt);}
            @Override public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic c){handle(c, c.getValue());}

            void handle(BluetoothGattCharacteristic c, byte[] v){
                if (v == null || v.length == 0) return;
                UUID u = c.getUuid();
                if (u.equals(TEMP) && v.length >= 2) lastT = (short) ((v[0] & 0xff) | (v[1] << 8)) / 100.0;
                else if (u.equals(HUM) && v.length >= 2) lastH = (int) Math.round(((v[0] & 0xff) | ((v[1] & 0xff) << 8)) / 100.0);
                else if (u.equals(MI_C) && v.length >= 3){lastT = (short) ((v[0] & 0xff) | (v[1] << 8)) / 100.0;lastH = v[2] & 0xff;}
                else if (u.equals(BAT_C)) batt = v[0] & 0xff;
                else return;
                try{
                    JSONObject o = new JSONObject();o.put("type", "data");o.put("id", id);o.put("name", name);
                    if (lastT != null) o.put("t", lastT);if (lastH != null) o.put("h", lastH);if (batt != null) o.put("batt", batt);
                    emit(o.toString());
                }catch(Exception e){}
            }
        });
        gatts.put(id, g);
    }

    static String json(String type, String id, String name){
        try{JSONObject o = new JSONObject();o.put("type", type);o.put("id", id);o.put("name", name);return o.toString();}catch(Exception e){return "{}";}
    }
}
