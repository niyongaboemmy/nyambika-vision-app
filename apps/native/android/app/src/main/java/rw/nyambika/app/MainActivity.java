package rw.nyambika.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import rw.nyambika.app.ambient.NyambikaLiveActivityPlugin;
import rw.nyambika.app.ambient.OrderNotifier;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugin (E38): Live Update notification + widget, same JS API as iOS.
        registerPlugin(NyambikaLiveActivityPlugin.class);
        super.onCreate(savedInstanceState);
        OrderNotifier.INSTANCE.ensureChannels(this);
    }
}
